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
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true 
    );
    // Force explicit prosody evaluation
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

    // 🚨 THE FIX: Extract the EXACT accuracy score for every single word
    const wordScores = assessmentResult.detailResult.Words.map(w => ({
      word: w.Word,
      accuracy: w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : 100
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        score: Math.round(assessmentResult.accuracyScore),
        fluency: Math.round(assessmentResult.fluencyScore),
        prosody: Math.round(assessmentResult.prosodyScore || assessmentResult.accuracyScore),
        heard: result.text,
        words: wordScores // Sending the X-Ray data to the frontend
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
