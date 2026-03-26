const sdk = require("microsoft-cognitiveservices-speech-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { audio, referenceText, locale } = JSON.parse(event.body);
    const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
    
    // This dynamically catches the US or UK accent from your frontend
    speechConfig.speechRecognitionLanguage = locale || "en-US";

    // The 'true' at the end is the magic key—it tells Azure to grade every single phoneme
    const pronConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true 
    );

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

    // THE UPGRADE: We filter Azure's massive data dump to find only the broken words
    const errors = assessmentResult.detailResult.Words
      .filter(w => w.ErrorType !== "None")
      .map(w => ({ word: w.Word, error: w.ErrorType }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        score: Math.round(assessmentResult.accuracyScore),
        fluency: Math.round(assessmentResult.fluencyScore),
        prosody: Math.round(assessmentResult.prosodyScore),
        heard: result.text,
        mispronunciations: errors // This is what populates your red warning boxes!
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
