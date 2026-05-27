const sdk = require("microsoft-cognitiveservices-speech-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { audio, referenceText, locale } = JSON.parse(event.body);
    const audioBuffer = Buffer.from(audio, 'base64');

    const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
    speechConfig.speechRecognitionLanguage = locale || "en-US";

    // --- PASS 1: Free Recognition (honest "heard") ---
    const pushStream1 = sdk.AudioInputStream.createPushStream();
    pushStream1.write(audioBuffer);
    pushStream1.close();
    const audioConfig1 = sdk.AudioConfig.fromStreamInput(pushStream1);
    const recognizer1 = new sdk.SpeechRecognizer(speechConfig, audioConfig1);

    const freeResult = await new Promise((resolve, reject) => {
      recognizer1.recognizeOnceAsync(res => resolve(res), err => reject(err));
    });

    const honestHeard = freeResult.text || "";

    // --- PASS 2: Pronunciation Assessment (scores + phonemes) ---
    const pronConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true
    );
    pronConfig.enableProsody = true;

    const pushStream2 = sdk.AudioInputStream.createPushStream();
    pushStream2.write(audioBuffer);
    pushStream2.close();
    const audioConfig2 = sdk.AudioConfig.fromStreamInput(pushStream2);
    const recognizer2 = new sdk.SpeechRecognizer(speechConfig, audioConfig2);
    pronConfig.applyTo(recognizer2);

    const rawResult = await new Promise((resolve, reject) => {
      recognizer2.recognizeOnceAsync(res => resolve(res), err => reject(err));
    });

    const assessmentResult = sdk.PronunciationAssessmentResult.fromResult(rawResult);

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
        heard: honestHeard, // ← honest transcription, not force-aligned
        words: wordScores
      })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
