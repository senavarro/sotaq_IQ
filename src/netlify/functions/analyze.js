const sdk = require("microsoft-cognitiveservices-speech-sdk");

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { audio, referenceText, locale } = JSON.parse(event.body);
    
    // 1. Setup Azure Config using your hidden Vault keys
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY, 
      process.env.AZURE_SPEECH_REGION
    );
    // Set the language (e.g., 'en-US' or 'en-GB')
    speechConfig.speechRecognitionLanguage = locale || "en-US";

    // 2. Configure the Pronunciation Assessment (The strict grading)
    const pronConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true // Enable prosody (checks the rhythm and accent)
    );

    // 3. Convert the audio from the app into a format Azure understands
    const audioBuffer = Buffer.from(audio, 'base64');
    const pushStream = sdk.AudioInputStream.createPushStream();
    pushStream.write(audioBuffer);
    pushStream.close();
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronConfig.applyTo(recognizer);

    // 4. Send to Azure and wait for the result
    const result = await new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(res => resolve(res), err => reject(err));
    });

    const assessmentResult = sdk.PronunciationAssessmentResult.fromResult(result);

    // 5. Send the exact scores back to your SotaQ App
    return {
      statusCode: 200,
      body: JSON.stringify({
        score: Math.round(assessmentResult.accuracyScore),
        fluency: Math.round(assessmentResult.fluencyScore),
        prosody: Math.round(assessmentResult.prosodyScore),
        heard: result.text
      })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
