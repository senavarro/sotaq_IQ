import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';

// --- THE NEW PHRASE LIBRARY ---
const practicePhrases = [
  "Where is the nearest subway station?",
  "I would like to order a large coffee, please.",
  "How much does this cost?",
  "Could you repeat that a little slower?",
  "The weather is absolutely beautiful today.",
  "Can we get the check, please?",
  "What time is our flight departing?",
  "It was really nice meeting you.",
  "Do you have any recommendations for dinner?",
  "I need to book a hotel room for two nights.",
  "Excuse me, do you speak English?",
  "I'm looking for a pharmacy.",
  "Can you help me with my luggage?",
  "This meal is absolutely delicious!",
  "I will see you tomorrow morning."
];

export default function QuevedoVIP() {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ count: 5, xp: 0 });
  const [text, setText] = useState('');
  const [accent, setAccent] = useState('en-US');
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // --- LOGIN LOGIC ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const mail = email.toLowerCase().trim();

    const { data: whitelist } = await supabase
      .from('allowed_users')
      .select('email')
      .eq('email', mail)
      .single();

    if (!whitelist) {
      setError('Acesso Negado. E-mail não encontrado na lista VIP.');
      return;
    }

    let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
    
    const today = new Date().toISOString().split('T')[0];
    if (uStats && uStats.last_played_date !== today) {
      const { data: updated } = await supabase
        .from('user_stats')
        .update({ daily_count: 5, last_played_date: today })
        .eq('email', mail).select().single();
      uStats = updated;
    }

    setStats({ count: uStats.daily_count, xp: uStats.total_xp });
    setUser(mail);
  };

  // --- NEW RANDOM PHRASE GENERATOR ---
  const loadRandomPhrase = () => {
    const random = practicePhrases[Math.floor(Math.random() * practicePhrases.length)];
    setText(random);
    setFeedback(null); // Clear old scores
  };

  // --- UPGRADED PRACTICE LOGIC ---
  const startPractice = () => {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!Speech) {
      alert("⚠️ Microfone não suportado.\n\n📱 iPhone: Abra este site no SAFARI.\n🤖 Android/PC: Use o CHROME.");
      return;
    }
    
    const rec = new Speech();
    rec.lang = accent;
    rec.interimResults = false; // Only wait for the final sentence
    
    // UX: Show user we are actively listening
    rec.onstart = () => {
      setIsRecording(true);
      setFeedback(null);
    };

    // UX: Automatically turn off when they pause
    rec.onend = () => setIsRecording(false);

    rec.onresult = async (e) => {
      const heardText = e.results[0][0].transcript.toLowerCase();
      const targetText = text.toLowerCase();

      // NEW GRADING ALGORITHM: Compare what was said vs what was typed
      const cleanHeard = heardText.replace(/[.,?!]/g, '');
      const cleanTarget = targetText.replace(/[.,?!]/g, '');
      
      const targetWords = cleanTarget.split(' ').filter(w => w);
      const heardWords = cleanHeard.split(' ').filter(w => w);

      let matchCount = 0;
      targetWords.forEach(word => {
        if (heardWords.includes(word)) matchCount++;
      });

      // Calculate accuracy percentage based on correct words
      let accuracy = 0;
      if (targetWords.length > 0) {
        accuracy = Math.round((matchCount / targetWords.length) * 100);
      } else {
        accuracy = Math.round(e.results[0][0].confidence * 100); // Fallback
      }

      let stars = accuracy >= 80 ? 3 : accuracy >= 50 ? 2 : 1;
      
      setFeedback({ stars, score: accuracy, heard: e.results[0][0].transcript });
      
      if (stars === 3) confetti({ colors: ['#ff6a00', '#1a2a6c'] });

      const newXP = stats.xp + (stars * 10);
      const newCount = stats.count - 1;
      
      await supabase.from('user_stats').update({ 
        daily_count: newCount, 
        total_xp: newXP 
      }).eq('email', user);

      setStats(prev => ({ ...prev, count: newCount, xp: newXP }));
    };
    
    rec.start();
  };

  if (!user) {
    return (
      <main style={{ background: '#f4f7f9', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', textAlign: 'center', borderTop: '5px solid #1a2a6c', maxWidth: '400px', width: '90%' }}>
           <div style={{ background: 'linear-gradient(120deg, #1a2a6c, #ff6a00)', color: 'white', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px', margin: '0 auto 20px', fontWeight: '900', fontSize: '24px' }}>Q</div>
           <h2 style={{ color: '#1a2a6c', marginBottom: '20px' }}>VIP Fluency Portal</h2>
           <form onSubmit={handleLogin}>
             <input type="email" placeholder="Seu E-mail VIP" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '15px', marginBottom: '15px', border: '1px solid #ddd', borderRadius: '8px', boxSizing: 'border-box' }} required />
             {error && <p style={{ color: '#ff3333', fontSize: '0.9rem', marginBottom: '15px' }}>{error}</p>}
             <button type="submit" style={{ background: '#ff6a00', color: 'white', border: 'none', padding: '15px', borderRadius: '50px', fontWeight: 'bold', cursor: 'pointer', width: '100%', fontSize: '16px' }}>ENTRAR</button>
           </form>
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #eee', paddingBottom: '15px' }}>
        <h3 style={{ color: '#1a2a6c', margin: 0 }}>Idiomas Quevedo</h3>
        <div style={{ textAlign: 'right' }}>
           <p style={{ margin: 0, fontWeight: 'bold', color: '#1a2a6c' }}>XP: {stats.xp}</p>
           <p style={{ margin: 0, color: '#ff6a00', fontWeight: 'bold' }}>Energia: {stats.count}/5</p>
        </div>
      </header>

      <div style={{ background: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <label style={{ fontWeight: 'bold', color: '#555' }}>O que vamos praticar?</label>
          <button onClick={loadRandomPhrase} style={{ background: 'none', border: 'none', color: '#ff6a00', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>
            🎲 Frase Aleatória
          </button>
        </div>

        <textarea 
          placeholder="Escreva uma frase em inglês ou clique em Frase Aleatória..." 
          value={text} 
          onChange={e => setText(e.target.value)}
          style={{ width: '100%', height: '100px', padding: '15px', borderRadius: '12px', border: '2px solid #eee', marginBottom: '20px', boxSizing: 'border-box', fontSize: '16px', resize: 'vertical' }}
        />
        
        <div style={{ display: 'flex', gap: '15px', marginBottom: '25px' }}>
          <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: accent === 'en-US' ? '2px solid #ff6a00' : '2px solid #eee', background: accent === 'en-US' ? '#fff5eb' : 'white', fontWeight: 'bold', cursor: 'pointer' }}>🇺🇸 Americano</button>
          <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: accent === 'en-GB' ? '2px solid #1a2a6c' : '2px solid #eee', background: accent === 'en-GB' ? '#f0f4f8' : 'white', fontWeight: 'bold', cursor: 'pointer' }}>🇬🇧 Britânico</button>
        </div>

        {/* UPGRADED UX BUTTON */}
        <button 
          onClick={startPractice} 
          disabled={stats.count <= 0 || isRecording || !text.trim()}
          style={{ 
            width: '100%', 
            padding: '18px', 
            borderRadius: '50px', 
            border: 'none', 
            background: isRecording ? '#ff3333' : (stats.count <= 0 || !text.trim() ? '#ccc' : '#1a2a6c'), 
            color: 'white', 
            fontWeight: 'bold', 
            fontSize: '16px',
            cursor: (stats.count <= 0 || isRecording || !text.trim()) ? 'not-allowed' : 'pointer',
            transition: 'background 0.3s ease',
            boxShadow: isRecording ? '0 0 15px rgba(255, 51, 51, 0.5)' : 'none'
          }}
        >
          {isRecording ? '🔴 Ouvindo... Fale agora' : '🎤 PRATICAR PRONÚNCIA'}
        </button>

        {/* UPGRADED FEEDBACK DISPLAY */}
        {feedback && (
          <div style={{ marginTop: '25px', textAlign: 'center', padding: '15px', background: '#f9f9f9', borderRadius: '12px' }}>
            <div style={{ fontSize: '2.5rem', color: '#ff6a00', letterSpacing: '5px' }}>{'★'.repeat(feedback.stars)}</div>
            <p style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#1a2a6c', margin: '10px 0' }}>Precisão: {feedback.score}%</p>
            <p style={{ fontSize: '0.9rem', color: '#666', fontStyle: 'italic', margin: 0 }}>Ouvimos: "{feedback.heard}"</p>
          </div>
        )}
      </div>
    </main>
  );
}
