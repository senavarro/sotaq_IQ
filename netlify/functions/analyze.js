const sdk = require("microsoft-cognitiveservices-speech-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { audio, referenceText, locale } = JSON.parse(event.body);
    const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
    speechConfig.speechRecognitionLanguage = locale || "en-US";

    const pronConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      // 🚨 THIS IS THE MAGIC KEY: We are asking for Phoneme data
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true 
    );
    pronConfig.enableProsody = true;

    const audioBuffer = Buffer.from(audio, 'base64');
    const pushStream = sdk.AudioInputStream.createPushStream();
    pushStream.write(audioBuffer);
    pushStream.close();
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronConfig.applyTo(recognizer);

    const result = await new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(res => resolve(res), err => reject(err));
    });

    const assessmentResult = sdk.PronunciationAssessmentResult.fromResult(result);

    // 🚨 THE UPGRADE: We now extract every single microscopic sound
    const wordScores = assessmentResult.detailResult.Words.map(w => {
      const phons = w.Phonemes ? w.Phonemes.map(p => ({
        sound: p.Phoneme,
        score: p.PronunciationAssessment ? p.PronunciationAssessment.AccuracyScore : 100
      })) : [];

      return {
        word: w.Word,
        accuracy: w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : 100,
        phonemes: phons // Sending the X-Ray data to the app
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        score: Math.round(assessmentResult.accuracyScore),
        fluency: Math.round(assessmentResult.fluencyScore),
        prosody: Math.round(assessmentResult.prosodyScore || assessmentResult.accuracyScore),
        heard: result.text,
        words: wordScores 
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
