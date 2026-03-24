import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';

const QuevedoApp = () => {
  // App State
  const [email, setEmail] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Gamification & Practice State
  const [stats, setStats] = useState({ count: 5, xp: 0, phrases: [] });
  const [text, setText] = useState('');
  const [accent, setAccent] = useState('en-US'); // Default: American
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // --- 1. VIP LOGIN LOGIC ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formattedEmail = email.toLowerCase().trim();

    // Check Whitelist
    const { data: whitelistData } = await supabase
      .from('allowed_users')
      .select('email')
      .eq('email', formattedEmail)
      .single();

    if (!whitelistData) {
      setError('Acesso Negado. Por favor, entre em contato com a equipe para entrar na lista VIP.');
      setLoading(false);
      return;
    }

    // Fetch or Reset Daily Stats
    let { data: userStats } = await supabase
      .from('user_stats')
      .select('*')
      .eq('email', formattedEmail)
      .single();

    // Reset daily count if it's a new day
    const today = new Date().toISOString().split('T')[0];
    if (userStats && userStats.last_played_date !== today) {
      const { data: updatedStats } = await supabase
        .from('user_stats')
        .update({ daily_count: 5, last_played_date: today })
        .eq('email', formattedEmail)
        .select()
        .single();
      userStats = updatedStats;
    }

    setStats({ count: userStats.daily_count, xp: userStats.total_xp, phrases: userStats.mastered_phrases });
    setUser(formattedEmail);
    setLoading(false);
  };

  // --- 2. THE QUEVEDO RANK SYSTEM ---
  const getRank = (xp) => {
    if (xp < 50) return 'Newcomer 🌱';
    if (xp < 200) return 'Global Traveler ✈️';
    if (xp < 500) return 'Business Executive 💼';
    return 'Global Negotiator 🌍';
  };

  // --- 3. SPEECH SYNTHESIS (HEAR IT) ---
  const playAudio = () => {
    if (!text) return;
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    
    // Find voice matching US or UK
    utterance.voice = voices.find(v => v.lang === accent) || voices[0];
    synth.speak(utterance);
  };

  // --- 4. SPEECH RECOGNITION (PRACTICE IT) ---
  const startPractice = () => {
    if (stats.count <= 0) {
      setError('Energia diária esgotada. Volte amanhã!');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Seu navegador não suporta análise de voz. Use o Google Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = accent;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsRecording(true);
      setFeedback(null);
    };

    recognition.onresult = async (event) => {
      const confidence = event.results[0][0].confidence; // Browser's clarity score (0.0 to 1.0)
      let stars = 1;
      let xpGained = 5;

      if (confidence > 0.85) { stars = 3; xpGained = 20; }
      else if (confidence > 0.60) { stars = 2; xpGained = 10; }

      setFeedback({ stars, score: Math.round(confidence * 100) });

      // Trigger gamification rewards
      if (stars === 3) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#ff6a00', '#1a2a6c'] });
      }

      // Update Database
      const newCount = stats.count - 1;
      const newXp = stats.xp + xpGained;
      const newPhrases = stars === 3 && text && !stats.phrases.includes(text) 
        ? [...stats.phrases, text] 
        : stats.phrases;

      await supabase.from('user_stats').update({ 
        daily_count: newCount, 
        total_xp: newXp,
        mastered_phrases: newPhrases
      }).eq('email', user);

      setStats({ count: newCount, xp: newXp, phrases: newPhrases });
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setError("Permissão de microfone negada ou erro na captura.");
      setIsRecording(false);
    };

    recognition.start();
  };

  // --- 5. HELPER: RANDOM SENTENCE ---
  const generateRandomSentence = () => {
    const phrases = [
      "I would like to schedule a meeting for next Tuesday.",
      "Could you please elaborate on the quarterly report?",
      "We need to think outside the box on this project.",
      "I'm looking forward to our collaboration."
    ];
    setText(phrases[Math.floor(Math.random() * phrases.length)]);
  };

  // --- RENDER: LOGIN SCREEN ---
  if (!user) {
    return (
      <div style={{ fontFamily: 'Raleway, sans-serif', minHeight: '100vh', background: '#f4f7f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', textAlign: 'center', maxWidth: '400px', width: '90%', borderTop: '4px solid #1a2a6c' }}>
          <div style={{ background: 'linear-gradient(120deg, #1a2a6c, #ff6a00)', color: 'white', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px', margin: '0 auto 20px', fontWeight: '900', fontSize: '1.5rem' }}>Q</div>
          <h2 style={{ color: '#1a2a6c', fontWeight: 800 }}>VIP Fluency Portal</h2>
          <p style={{ color: '#555', marginBottom: '20px' }}>Insira seu e-mail para acessar.</p>
          
          <form onSubmit={handleLogin}>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="E-mail VIP"
              style={{ width: '100%', padding: '12px 15px', marginBottom: '15px', border: error ? '2px solid #ff0000' : '2px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', boxSizing: 'border-box' }}
              required
            />
            {error && <p style={{ color: '#ff0000', fontSize: '0.85rem', marginBottom: '15px', fontWeight: 'bold' }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ background: '#ff6a00', color: '#fff', padding: '1em 2.5em', border: 'none', borderRadius: '50px', fontWeight: 700, width: '100%', cursor: 'pointer', textTransform: 'uppercase' }}>
              {loading ? 'Verificando...' : 'Acessar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- RENDER: DASHBOARD ---
  return (
    <div style={{ fontFamily: 'Raleway, sans-serif', minHeight: '100vh', background: '#f4f7f9', padding: '40px 20px' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        
        {/* Header & Stats */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', background: 'white', padding: '20px', borderRadius: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <div>
            <h3 style={{ color: '#1a2a6c', margin: 0, fontWeight: 800 }}>Bem-vindo de volta!</h3>
            <p style={{ color: '#ff6a00', margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>Rank: {getRank(stats.xp)} ({stats.xp} XP)</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, color: '#555', fontSize: '0.85rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Energia Diária</p>
            <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{ width: '15px', height: '15px', borderRadius: '50%', background: i <= stats.count ? '#ff6a00' : '#e2e8f0' }} />
              ))}
            </div>
          </div>
        </div>

        {/* Main Practice Area */}
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', borderTop: '4px solid #1a2a6c', marginBottom: '30px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
             <label style={{ fontWeight: 'bold', color: '#1a2a6c' }}>O que vamos praticar hoje?</label>
             <button onClick={generateRandomSentence} style={{ background: 'none', border: 'none', color: '#ff6a00', cursor: 'pointer', fontWeight: 'bold', textDecoration: 'underline' }}>Surprise Me 🎲</button>
          </div>

          <textarea 
            value={text} 
            onChange={(e) => setText(e.target.value)} 
            placeholder="Digite uma frase ou use o botão 'Surprise Me'..."
            style={{ width: '100%', height: '100px', padding: '15px', border: '2px solid #e2e8f0', borderRadius: '12px', fontSize: '1.1rem', marginBottom: '20px', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />

          {/* Controls */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '10px', flex: 1 }}>
              <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: accent === 'en-US' ? '2px solid #1a2a6c' : '1px solid #e2e8f0', background: accent === 'en-US' ? '#fdf2e9' : 'white', cursor: 'pointer', fontWeight: 'bold' }}>🇺🇸 Americano</button>
              <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: accent === 'en-GB' ? '2px solid #1a2a6c' : '1px solid #e2e8f0', background: accent === 'en-GB' ? '#fdf2e9' : 'white', cursor: 'pointer', fontWeight: 'bold' }}>🇬🇧 Britânico</button>
            </div>
            <button onClick={playAudio} style={{ flex: 1, background: '#f0f4f8', color: '#1a2a6c', border: '2px solid #1a2a6c', borderRadius: '50px', fontWeight: 800, cursor: 'pointer', padding: '10px' }}>🔊 OUVIR</button>
          </div>

          {/* Record Button & Feedback */}
          <div style={{ textAlign: 'center', padding: '20px', background: '#f8fafc', borderRadius: '15px', border: '1px solid #e2e8f0' }}>
            <button 
              onClick={startPractice} 
              disabled={isRecording || stats.count <= 0 || !text}
              style={{ 
                background: isRecording ? '#e74c3c' : (stats.count > 0 ? '#1a2a6c' : '#bdc3c7'), 
                color: 'white', padding: '15px 40px', border: 'none', borderRadius: '50px', fontWeight: 800, fontSize: '1.1rem', cursor: (stats.count > 0 && !isRecording) ? 'pointer' : 'not-allowed', textTransform: 'uppercase', boxShadow: isRecording ? '0 0 15px rgba(231, 76, 60, 0.6)' : 'none', transition: '0.3s'
              }}>
              {isRecording ? '🎙️ Escutando...' : '🎤 Falar Agora'}
            </button>
            
            {error && <p style={{ color: '#e74c3c', marginTop: '15px', fontWeight: 'bold' }}>{error}</p>}

            {feedback && !isRecording && (
              <div style={{ marginTop: '20px', animation: 'fadeIn 0.5s' }}>
                <div style={{ color: '#fbbc05', fontSize: '2rem', letterSpacing: '5px' }}>
                  {Array(3).fill('★').map((star, i) => (
                    <span key={i} style={{ opacity: i < feedback.stars ? 1 : 0.3 }}>{star}</span>
                  ))}
                </div>
                <h4 style={{ color: '#1a2a6c', margin: '10px 0 5px' }}>
                  {feedback.stars === 3 ? "Perfect! Pure VIP status. 🏆" : feedback.stars === 2 ? "Muito bom! Quase lá. 👍" : "A IA ficou confusa. Tente novamente! 💡"}
                </h4>
                <p style={{ color: '#555', margin: 0, fontSize: '0.9rem' }}>Clareza detectada: {feedback.score}%</p>
              </div>
            )}
          </div>
        </div>

        {/* Mastered Phrases Section */}
        {stats.phrases.length > 0 && (
          <div style={{ background: 'white', padding: '30px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}>
             <h4 style={{ color: '#1a2a6c', fontWeight: 800, margin: '0 0 15px', textTransform: 'uppercase' }}>🌟 Suas Frases Dominadas</h4>
             <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
               {stats.phrases.map((phrase, index) => (
                 <li key={index} style={{ padding: '10px 15px', background: '#fdf2e9', borderLeft: '4px solid #ff6a00', marginBottom: '10px', borderRadius: '0 10px 10px 0', color: '#444', fontWeight: '500' }}>
                   {phrase}
                 </li>
               ))}
             </ul>
          </div>
        )}

      </div>
    </div>
  );
};

export default QuevedoApp;