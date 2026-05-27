const sdk = require("microsoft-cognitiveservices-speech-sdk");

const cleanWord = (word) => word.toLowerCase().replace(/[^\w]/g, '');

const wordSimilarity = (a, b) => {
  a = cleanWord(a);
  b = cleanWord(b);
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;
  if (a.startsWith(b) || b.startsWith(a)) return 0.7;
  
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { audio, referenceText, locale } = JSON.parse(event.body);
    const audioBuffer = Buffer.from(audio, 'base64');
    const resolvedLocale = locale || "en-US";

    const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
    speechConfig.speechRecognitionLanguage = resolvedLocale;

    const [freeResult, assessedResult] = await Promise.all([

      // Pass 1: Free recognition with correct locale
      new Promise((resolve, reject) => {
        const pushStream = sdk.AudioInputStream.createPushStream();
        pushStream.write(audioBuffer);
        pushStream.close();
        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        // Use locale-specific speech config for Pass 1 too
        const localeSpeechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
        localeSpeechConfig.speechRecognitionLanguage = resolvedLocale;
        const recognizer = new sdk.SpeechRecognizer(localeSpeechConfig, audioConfig);
        recognizer.recognizeOnceAsync(res => resolve(res), err => reject(err));
      }),

      // Pass 2: Pronunciation assessment
      new Promise((resolve, reject) => {
        const pronConfig = new sdk.PronunciationAssessmentConfig(
          referenceText,
          sdk.PronunciationAssessmentGradingSystem.HundredMark,
          sdk.PronunciationAssessmentGranularity.Phoneme,
          true
        );
        pronConfig.enableProsody = true;

        const pushStream = sdk.AudioInputStream.createPushStream();
        pushStream.write(audioBuffer);
        pushStream.close();
        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        pronConfig.applyTo(recognizer);
        recognizer.recognizeOnceAsync(res => resolve(res), err => reject(err));
      })

    ]);

    const honestHeard = freeResult.text || "";
    const heardWords = honestHeard.split(' ').filter(w => w.length > 0);
    const referenceWords = referenceText.split(' ').filter(w => w.length > 0);
    const assessmentResult = sdk.PronunciationAssessmentResult.fromResult(assessedResult);

    const wordScores = assessmentResult.detailResult.Words.map((w, index) => {
      const phons = w.Phonemes ? w.Phonemes.map(p => ({
        sound: p.Phoneme,
        score: p.PronunciationAssessment ? p.PronunciationAssessment.AccuracyScore : 100
      })) : [];

      let accuracy = w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : 100;

      const heardWord = heardWords[index] || "";
      const refWord = referenceWords[index] || w.Word;
      const similarity = wordSimilarity(heardWord, refWord);

      if (similarity < 0.6 && heardWord.length > 0) {
        accuracy = Math.min(accuracy, 40);
        phons.forEach(p => { p.score = Math.min(p.score, 40); });
      } else if (similarity < 0.8) {
        accuracy = Math.min(accuracy, 70);
      }

      // Find the single worst phoneme regardless of overall score
      // This surfaces subtle errors even on high-scoring words
      const worstPhonemeScore = phons.length > 0 ? Math.min(...phons.map(p => p.score)) : 100;

      // If any phoneme is below 80, flag the word even if overall accuracy is high
      if (worstPhonemeScore < 80 && accuracy > 80) {
        accuracy = Math.min(accuracy, 79);
      }

      return {
        word: w.Word,
        accuracy,
        phonemes: phons,
        worstPhonemeScore
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        score: Math.round(assessmentResult.accuracyScore),
        fluency: Math.round(assessmentResult.fluencyScore),
        prosody: Math.round(assessmentResult.prosodyScore || assessmentResult.accuracyScore),
        heard: honestHeard,
        words: wordScores
      })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
