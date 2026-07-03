const sdk = require("microsoft-cognitiveservices-speech-sdk");

// Spanish-only pronunciation-assessment endpoint. This is a fork of
// analyze-ios.js, not a shared module — analyze-ios.js is left completely
// untouched so nothing here can affect English scoring. Any future
// improvements to Spanish scoring should happen in this file only.

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
  'es-ES': new Set(['r', 'θ', 'x', 'ʎ', 'ɲ', 'ð', 'β', 'tʃ', 't', 'd']),
  'es-MX': new Set(['r', 'ɾ', 's', 'j', 'x', 'ɲ', 'ð', 't', 'p', 'd'])
};

const excludePhonemes = {
  'es-ES': new Set(),
  // es-MX uses seseo (no lisp) — if Azure ever tags a sound as θ under this
  // locale it's a model quirk, not a real learner error.
  'es-MX': new Set(['θ'])
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { audio, referenceText, locale, lightPass = false } = JSON.parse(event.body);
    const audioBuffer    = Buffer.from(audio, 'base64');
    const resolvedLocale = (locale === 'es-MX') ? 'es-MX' : 'es-ES';
    const critical       = criticalPhonemes[resolvedLocale];
    const exclude        = excludePhonemes[resolvedLocale];

    const baseCfg = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
    baseCfg.speechRecognitionLanguage = resolvedLocale;

    const [freeResult, assessedResult] = await Promise.all([

      // Pass 1: honest transcription — always runs.
      // Note: for short, predictable phrases, Azure's language model can
      // auto-correct ambiguous audio to the nearest real sentence, so
      // `honestHeard` isn't guaranteed to reflect exactly what was said.
      // That's expected ASR behavior, not something fixable here — it's why
      // the ErrorType check below matters: it's Azure's own per-word
      // mispronunciation flag, independent of this transcription.
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
              true // enableMiscueCalculation — read below via ErrorType
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

    // ===== TEMPORARY DEBUG LOGGING — remove once scoring is settled =====
    // Logs the raw Azure numbers before any of our own penalty/critical-
    // phoneme logic touches them, so we can see ground truth instead of
    // inferring it from what the client displays. View these in the
    // Netlify dashboard under Functions → analyze-ios-es → real-time logs,
    // or via `netlify functions:log analyze-ios-es` if using the CLI.
    console.log('=== analyze-ios-es DEBUG ===');
    console.log('resolvedLocale:', resolvedLocale);
    console.log('referenceText:', referenceText);
    console.log('honestHeard (Pass 1):', honestHeard);
    console.log('utterance-level scores:', JSON.stringify({
      accuracyScore: assessmentResult.accuracyScore,
      fluencyScore: assessmentResult.fluencyScore,
      prosodyScore: assessmentResult.prosodyScore,
      completenessScore: assessmentResult.completenessScore
    }));
    console.log('per-word raw Azure data:', JSON.stringify(
      assessmentResult.detailResult.Words.map(w => ({
        word: w.Word,
        accuracyScore: w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : null,
        errorType: w.PronunciationAssessment ? w.PronunciationAssessment.ErrorType : null,
        phonemes: (w.Phonemes || []).map(p => ({
          sound: p.Phoneme,
          score: p.PronunciationAssessment ? p.PronunciationAssessment.AccuracyScore : null
        }))
      }))
    ));
    console.log('=== END DEBUG ===');
    // ===== END TEMPORARY DEBUG LOGGING =====

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

      // Azure's miscue detection (enabled above) computes an ErrorType per
      // word independent of the freeform transcription. This is the
      // signal that actually caught "draerme"/"faver" — the freeform
      // transcript auto-corrected to the reference words, so the
      // wordSimilarity backstop below saw a perfect match and did nothing.
      const errorType = w.PronunciationAssessment ? w.PronunciationAssessment.ErrorType : 'None';
      if (errorType === 'Mispronunciation') {
        accuracy = Math.min(accuracy, 55);
        phons.forEach(p => { p.score = Math.min(p.score, 55); });
      } else if (errorType === 'Omission') {
        accuracy = 0;
        phons.forEach(p => { p.score = 0; });
      } else if (errorType === 'Insertion') {
        accuracy = Math.min(accuracy, 40);
      }

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

    // ===== TEMPORARY DEBUG LOGGING (continued) =====
    const overallMinPhoneme = wordScores.length
      ? Math.min(...wordScores.map(w => w.worstPhonemeScore))
      : null;
    console.log('post-processing word scores:', JSON.stringify(
      wordScores.map(w => ({ word: w.word, accuracy: w.accuracy, worstPhonemeScore: w.worstPhonemeScore }))
    ));
    console.log('overallMinPhoneme (this is the value the client formula weights at 0.5):', overallMinPhoneme);
    // ===== END TEMPORARY DEBUG LOGGING (continued) =====

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
      intonationNote = "Ritmo plano — o espanhol tem um ritmo silábico regular e bem marcado.";
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
