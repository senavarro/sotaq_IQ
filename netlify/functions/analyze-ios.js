const sdk = require("microsoft-cognitiveservices-speech-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { audio, referenceText, locale } = JSON.parse(event.body);
    const audioBuffer = Buffer.from(audio, 'base64');

    const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
    speechConfig.speechRecognitionLanguage = locale || "en-US";

    // --- BOTH PASSES IN PARALLEL ---
    const [freeResult, assessedResult] = await Promise.all([

      // Pass 1: Free recognition (honest "heard")
      new Promise((resolve, reject) => {
        const pushStream = sdk.AudioInputStream.createPushStream();
        pushStream.write(audioBuffer);
        pushStream.close();
        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        recognizer.recognizeOnceAsync(res => resolve(res), err => reject(err));
      }),

      // Pass 2: Pronunciation assessment (scores + phonemes)
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
    const assessmentResult = sdk.PronunciationAssessmentResult.fromResult(assessedResult);

    const wordScores = assessmentResult.detailResult.Words.map(w => {
      const phons = w.Phonemes ? w.Phonemes.map(p => ({
        sound: p.Phoneme,
        score: p.PronunciationAssessment ? p.PronunciationAssessment.AccuracyScore : 100
      })) : [];
      return {
        word: w.Word,
        accuracy: w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : 100,
        phonemes: phons
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
