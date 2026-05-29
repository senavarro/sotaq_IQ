const sdk = require("microsoft-cognitiveservices-speech-sdk");

const cleanWord = (w) => w.toLowerCase().replace(/[^\w]/g, '');

const wordSimilarity = (a, b) => {
  a = cleanWord(a); b = cleanWord(b);
  if (a === b) return 1.0;
  if (!a.length || !b.length) return 0.0;
  if (a.startsWith(b) || b.startsWith(a)) return 0.7;
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer  = a.length < b.length ? b : a;
  for (const c of shorter) { if (longer.includes(c)) matches++; }
  return matches / longer.length;
};

const criticalPhonemes = {
  'en-US': new Set(['ɹ', 'æ', 'eɪ', 'aɪ', 'oʊ', 'ɾ', 'ʌ', 'θ', 'ð', 'w', 'ŋ']),
  'en-GB': new Set(['ɑː', 'ɒ', 'əʊ', 'ɪə', 'eə', 'ʊə', 'ɔː', 'θ', 'ð', 'ɪ', 'ʌ', 'ŋ'])
};

const excludePhonemes = {
  'en-US': new Set(['ɒ', 'ɑː', 'ɔː', 'əʊ', 'ɪə', 'eə', 'ʊə']),
  'en-GB': new Set(['oʊ', 'ɾ', 'æ'])
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { audio, referenceText, locale, lightPass = false } = JSON.parse(event.body);
    const audioBuffer    = Buffer.from(audio, 'base64');
    const resolvedLocale = locale || 'en-US';
    const critical       = criticalPhonemes[resolvedLocale] || criticalPhonemes['en-US'];
    const exclude        = excludePhonemes[resolvedLocale]  || new Set();

    const baseCfg = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
    baseCfg.speechRecognitionLanguage = resolvedLocale;

    const [freeResult, assessedResult] = await Promise.all([

      // Pass 1: honest transcription — always runs
      new Promise((resolve, reject) => {
        const cfg = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
        cfg.speechRecognitionLanguage = resolvedLocale;
        const stream = sdk.AudioInputStream.createPushStream();
        stream.write(audioBuffer); stream.close();
        const rec = new sdk.SpeechRecognizer(cfg, sdk.AudioConfig.fromStreamInput(stream));
        rec.recognizeOnceAsync(r => resolve(r), e => reject(e));
      }),

      // Pass 2: pronunciation assessment — skipped on light pass
      lightPass
        ? Promise.resolve(null)
        : new Promise((resolve, reject) => {
            const pron = new sdk.PronunciationAssessmentConfig(
              referenceText,
              sdk.PronunciationAssessmentGradingSystem.HundredMark,
              sdk.PronunciationAssessmentGranularity.Phoneme,
              true
            );
            pron.enableProsody = true;
            const stream = sdk.AudioInputStream.createPushStream();
            stream.write(audioBuffer); stream.close();
            const rec = new sdk.SpeechRecognizer(baseCfg, sdk.AudioConfig.fromStreamInput(stream));
            pron.applyTo(rec);
            rec.recognizeOnceAsync(r => resolve(r), e => reject(e));
          })
    ]);

    const honestHeard = freeResult.text || '';
    const heardWords  = honestHeard.split(' ').filter(w => w);
    const refWords    = referenceText.split(' ').filter(w => w);

    const cleanRefWords   = refWords.map(cleanWord);
    const cleanHeardWords = heardWords.map(cleanWord);
    const matchedCount    = cleanRefWords.filter(w => cleanHeardWords.includes(w)).length;
    const comprehensibility = Math.round((matchedCount / Math.max(cleanRefWords.length, 1)) * 100);

    // Light pass early return — only transcription, no phoneme data
    if (lightPass) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          score:            comprehensibility,
          fluency:          comprehensibility,
          prosody:          50,
          heard:            honestHeard,
          words:            refWords.map(w => ({ word: w, accuracy: comprehensibility, phonemes: [] })),
          comprehensibility,
          mainChallenge:    null,
          intonationNote:   null,
          lightPass:        true
        })
      };
    }

    // Full pass — pronunciation assessment
    const assessmentResult = sdk.PronunciationAssessmentResult.fromResult(assessedResult);

    const phonemeIssues = {};

    const wordScores = assessmentResult.detailResult.Words.map((w, i) => {
      const phons = (w.Phonemes || []).map(p => {
        const sound = p.Phoneme;
        let score   = p.PronunciationAssessment ? p.PronunciationAssessment.AccuracyScore : 100;

        if (exclude.has(sound)) return { sound, score: 100 };

        if (critical.has(sound) && score < 65) {
          score = Math.max(0, score - 10);
        }

        if (score < 75) {
          if (!phonemeIssues[sound]) phonemeIssues[sound] = { count: 0, totalScore: 0, isCritical: critical.has(sound) };
          phonemeIssues[sound].count++;
          phonemeIssues[sound].totalScore += score;
        }

        return { sound, score };
      });

      let accuracy = w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : 100;

      const heardWord = heardWords[i] || '';
      const refWord   = refWords[i] || w.Word;
      const sim       = wordSimilarity(heardWord, refWord);
      if      (sim < 0.5 && heardWord) { accuracy = Math.min(accuracy, 30); phons.forEach(p => { p.score = Math.min(p.score, 30); }); }
      else if (sim < 0.7 && heardWord) { accuracy = Math.min(accuracy, 55); phons.forEach(p => { p.score = Math.min(p.score, 55); }); }
      else if (sim < 0.85)             { accuracy = Math.min(accuracy, 75); }

      const worstPhoneme = phons.length > 0 ? Math.min(...phons.map(p => p.score)) : 100;
      if (worstPhoneme < 80 && accuracy > 80) accuracy = Math.min(accuracy, 79);

      return { word: w.Word, accuracy, phonemes: phons, worstPhonemeScore: worstPhoneme };
    });

    let mainChallenge = null;
    const issueEntries = Object.entries(phonemeIssues);
    if (issueEntries.length > 0) {
      issueEntries.sort((a, b) => {
        const aScore = a[1].count + (a[1].isCritical ? 3 : 0);
        const bScore = b[1].count + (b[1].isCritical ? 3 : 0);
        return bScore - aScore;
      });
      const [sound, data] = issueEntries[0];
      mainChallenge = {
        phoneme:      sound,
        occurrences:  data.count,
        averageScore: Math.round(data.totalScore / data.count),
        isCritical:   data.isCritical
      };
    }

    const prosody = Math.round(assessmentResult.prosodyScore || assessmentResult.accuracyScore);
    let intonationNote = null;
    if (prosody < 45) {
      intonationNote = resolvedLocale === 'en-GB'
        ? "Ritmo plano — o inglês britânico tem sílabas tônicas bem marcadas e melodia clara."
        : "Ritmo plano — o inglês americano tem melodia suave e palavras-chave bem enfatizadas.";
    } else if (prosody < 65) {
      intonationNote = "Entonação razoável — tente enfatizar as palavras mais importantes da frase.";
    } else if (prosody >= 82) {
      intonationNote = "Entonação excelente! Soa muito natural. 🎵";
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        score:            Math.round(assessmentResult.accuracyScore),
        fluency:          Math.round(assessmentResult.fluencyScore),
        prosody,
        heard:            honestHeard,
        words:            wordScores,
        comprehensibility,
        mainChallenge,
        intonationNote
      })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
