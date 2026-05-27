const sdk = require("microsoft-cognitiveservices-speech-sdk");

// Simple word cleaner - removes punctuation and lowercases
const cleanWord = (word) => word.toLowerCase().replace(/[^\w]/g, '');

// Basic similarity check between two words (catches "hab"/"have", "pein"/"pain" etc)
const wordSimilarity = (a, b) => {
  a = cleanWord(a);
  b = cleanWord(b);
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;
  
  // Check if one starts with the other (catches truncations)
  if (a.startsWith(b) || b.startsWith(a)) return 0.7;
  
  // Count matching characters in sequence
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

    // --- CROSS-REFERENCE: Use Pass 1 to veto inflated Pass 2 scores ---
    const heardWords = honestHeard.split(' ').filter(w => w.length > 0);
    const referenceWords = referenceText.split(' ').filter(w => w.length > 0);

    const assessmentResult = sdk.PronunciationAssessmentResult.fromResult(assessedResult);

    const wordScores = assessmentResult.detailResult.Words.map((w, index) => {
      const phons = w.Phonemes ? w.Phonemes.map(p => ({
        sound: p.Phoneme,
        score: p.PronunciationAssessment ? p.PronunciationAssessment.AccuracyScore : 100
      })) : [];

      let accuracy = w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : 100;

      // Find what the user actually said at this word position
      const heardWord = heardWords[index] || "";
      const refWord = referenceWords[index] || w.Word;
      const similarity = wordSimilarity(heardWord, refWord);

      // If Pass 1 heard something clearly different, cap the score
      // Similarity below 0.6 means it was quite wrong
      if (similarity < 0.6 && heardWord.length > 0) {
        accuracy = Math.min(accuracy, 40);

        // Also drag down the phoneme scores so Raio-X highlights them
        phons.forEach(p => {
          p.score = Math.min(p.score, 40);
        });
      } else if (similarity < 0.8) {
        // Partially wrong - cap at 70 so it shows as a mild error
        accuracy = Math.min(accuracy, 70);
      }

      return {
        word: w.Word,
        accuracy,
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
