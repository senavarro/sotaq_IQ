import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';

const fallbackWords = ["Beautiful", "Development", "Opportunity", "Technology", "Language", "Vocabulary", "Pronunciation", "Experience", "Knowledge", "Challenge"];
const fallbackPhrases = [
  "Where is the nearest subway station?", "I would like to order a large coffee, please.",
  "The weather is absolutely beautiful today.", "Can we get the check, please?",
  "It was really nice meeting you.", "Do you have any recommendations for dinner?",
  "Excuse me, do you speak English?", "This meal is absolutely delicious!"
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
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // --- AUTOMATIC SESSION RESTORE ---
  useEffect(() => {
    const savedEmail = localStorage.getItem('quevedo_vip_user');
    if (savedEmail) {
      restoreSession(savedEmail);
    }
  }, []);

  const restoreSession = async (mail) => {
    let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
    if (uStats) {
      const today = new Date().toISOString().split('T')[0];
      if (uStats.last_played_date !== today) {
        const { data: updated } = await supabase.from('user_stats').update({ daily_count: 5, last_played_date: today }).eq('email', mail).select().single();
        uStats = updated;
      }
      setStats({ count: uStats.daily_count, xp: uStats.total_xp });
      setUser(mail);
    }
  };

  // --- LOGIN & LOGOUT LOGIC ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const mail = email.toLowerCase().trim();

    const { data: whitelist } = await supabase.from('allowed_users').select('email').eq('email', mail).single();

    if (!whitelist) {
      setError('Acesso Negado. E-mail não encontrado na lista VIP.');
      return;
    }

    let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
    
    const today = new Date().toISOString().split('T')[0];
    if (uStats && uStats.last_played_date !== today) {
      const { data: updated } = await supabase.from('user_stats').update({ daily_count: 5, last_played_date: today }).eq('email', mail).select().single();
      uStats = updated;
    }

    // Save to local storage for future visits
    localStorage.setItem('quevedo_vip_user', mail);
    setStats({ count: uStats.daily_count, xp: uStats.total_xp });
    setUser(mail);
  };

  const handleLogout = () => {
    localStorage.removeItem('quevedo_vip_user');
    setUser(null);
    setStats({ count: 5, xp: 0 });
    setFeedback(null);
    setText('');
  };

  const loadRandomWord = async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const response = await fetch('https://random-word-api.herokuapp.com/word');
      const data = await response.json();
      setText(data[0].charAt(0).toUpperCase() + data[0].slice(1)); 
    } catch (err) {
      setText(fallbackWords[Math.floor(Math.random() * fallbackWords.length)]);
    }
    setIsLoading(false);
  };

  const loadRandomPhrase = async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const response = await fetch('https://dummyjson.com/quotes/random');
      const data = await response.json();
      setText(data.quote);
    } catch (err) {
      setText(fallbackPhrases[Math.floor(Math.random() * fallbackPhrases.length)]);
    }
    setIsLoading(false);
  };

  const playAudio = (speed = 1.0) => {
    if (!text) return;
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = accent;
    utterance.rate = speed; 
    window.speechSynthesis.speak(utterance);
  };

  const startPractice = () => {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!Speech) {
      alert("⚠️ Microfone não suportado.\n\n📱 iPhone: Abra este site no SAFARI.\n🤖 Android/PC: Use o CHROME.");
      return;
    }
    
    const rec = new Speech();
    rec.lang = accent;
    rec.interimResults = false;
    
    rec.onstart = () => { setIsRecording(true); setFeedback(null); };
    rec.onend = () => setIsRecording(false);

    rec.onresult = async (e) => {
      const transcript = e.results[0][0].transcript;
      const confidence = e.results[0][0].confidence; 
      
      const heardText = transcript.toLowerCase();
      const targetText = text.toLowerCase();

      const cleanHeard = heardText.replace(/[.,?!'"-]/g, '');
      const cleanTarget = targetText.replace(/[.,?!'"-]/g, '');
      
      const targetWords = cleanTarget.split(' ').filter(w => w);
      const heardWords = cleanHeard.split(' ').filter(w => w);

      let matchCount = 0;
      let heardPool = [...heardWords]; 
      
      targetWords.forEach(word => { 
        const index = heardPool.indexOf(word);
        if (index !== -1) {
          matchCount++;
          heardPool.splice(index, 1); 
        }
      });

      let baseAccuracy = 0;
      if (targetWords.length > 0) {
        baseAccuracy = (matchCount / targetWords.length) * 100;
      } else {
        baseAccuracy = confidence * 100;
      }

      if (heardWords.length > targetWords.length) {
        const extraWords = heardWords.length - targetWords.length;
        baseAccuracy -= (extraWords * 5); 
      }

      let accuracy = Math.round(baseAccuracy * confidence);

      if (accuracy < 0) accuracy = 0;
      if (accuracy > 100) accuracy = 100;

      let stars = accuracy >= 90 ? 3 : accuracy >= 70 ? 2 : accuracy >= 40 ? 1 : 0;
      
      setFeedback({ stars, score: accuracy, heard: transcript });
      
      if (stars === 3) confetti({ colors: ['#ff6a00', '#1a2a6c'] });

      const newXP = stats.xp + (stars * 10);
      const newCount = stats.count - 1;
      
      await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
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
    <main style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif', position: 'relative' }}>
      
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', boxSizing: 'border-box' }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '20px', maxWidth: '400px', width: '100%', position: 'relative', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#999' }}>✖</button>
            <h3 style={{ color: '#1a2a6c', marginTop: 0 }}>Como Funciona?</h3>
            <ol style={{ paddingLeft: '20px', color: '#444', lineHeight: '1.6' }}>
              <li style={{ marginBottom: '10px' }}><strong>Gere uma frase ou palavra</strong> usando os botões azuis ou laranjas.</li>
              <li style={{ marginBottom: '10px' }}>Aperte 🔊 para ouvir a pronúncia, ou 🐢 para ouvir devagar.</li>
              <li style={{ marginBottom: '10px' }}>Escolha o sotaque que deseja praticar (Americano ou Britânico).</li>
              <li style={{ marginBottom: '10px' }}>Aperte <strong>"Praticar Pronúncia"</strong>. O botão ficará vermelho.</li>
              <li style={{ marginBottom: '10px' }}>Leia o texto em voz alta claramente. O microfone desliga sozinho quando você parar de falar.</li>
              <li>Ganhe estrelas e XP baseado na sua precisão!</li>
            </ol>
            <button onClick={() => setIsModalOpen(false)} style={{ width: '100%', background: '#ff6a00', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: 'bold', marginTop: '15px', cursor: 'pointer' }}>Entendi!</button>
          </div>
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #eee', paddingBottom: '15px' }}>
        <div>
          <h3 style={{ color: '#1a2a6c', margin: 0, marginBottom: '5px' }}>Idiomas Quevedo</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setIsModalOpen(true)} style={{ background: '#f0f4f8', color: '#1a2a6c', border: '1px solid #cce0f5', padding: '5px 10px', borderRadius: '50px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}>
              ❓ Como funciona?
            </button>
            <button onClick={handleLogout} style={{ background: 'transparent', color: '#999', border: 'none', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>
              Sair
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
           <p style={{ margin: 0, fontWeight: 'bold', color: '#1a2a6c' }}>XP: {stats.xp}</p>
           <p style={{ margin: 0, color: '#ff6a00', fontWeight: 'bold' }}>Energia: {stats.count}/5</p>
        </div>
      </header>

      <div style={{ background: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
          <label style={{ fontWeight: 'bold', color: '#555' }}>O que vamos praticar?</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={loadRandomWord} disabled={isLoading || isRecording} style={{ background: '#e0f2fe', border: 'none', color: '#0284c7', padding: '8px 15px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem' }}>
              🎲 Palavra
            </button>
            <button onClick={loadRandomPhrase} disabled={isLoading || isRecording} style={{ background: '#ffedd5', border: 'none', color: '#ea580c', padding: '8px 15px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem' }}>
              🎲 Frase
            </button>
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <textarea 
            placeholder="Escreva algo em inglês ou use os botões acima..." 
            value={isLoading ? "Buscando no dicionário..." : text} 
            onChange={e => setText(e.target.value)}
            disabled={isLoading || isRecording}
            style={{ width: '100%', height: '100px', padding: '15px', paddingRight: '100px', borderRadius: '12px', border: '2px solid #eee', boxSizing: 'border-box', fontSize: '16px', resize: 'vertical' }}
          />
          {text && !isLoading && (
            <div style={{ position: 'absolute', top: '15px', right: '15px', display: 'flex', gap: '8px' }}>
              <button onClick={() => playAudio(0.5)} title="Ouvir devagar" style={{ background: '#e6f7ff', border: '1px solid #bae0ff', borderRadius: '50%', width: '35px', height: '35px', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🐢</button>
              <button onClick={() => playAudio(1.0)} title="Ouvir pronúncia" style={{ background: '#f0f4f8', border: 'none', borderRadius: '50%', width: '35px', height: '35px', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>🔊</button>
            </div>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: '15px', marginBottom: '25px' }}>
          <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: accent === 'en-US' ? '2px solid #ff6a00' : '2px solid #eee', background: accent === 'en-US' ? '#fff5eb' : 'white', fontWeight: 'bold', cursor: 'pointer' }}>🇺🇸 Americano</button>
          <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: accent === 'en-GB' ? '2px solid #1a2a6c' : '2px solid #eee', background: accent === 'en-GB' ? '#f0f4f8' : 'white', fontWeight: 'bold', cursor: 'pointer' }}>🇬🇧 Britânico</button>
        </div>

        <button 
          onClick={startPractice} 
          disabled={stats.count <= 0 || isRecording || !text.trim() || isLoading}
          style={{ 
            width: '100%', padding: '18px', borderRadius: '50px', border: 'none', 
            background: isRecording ? '#ff3333' : (stats.count <= 0 || !text.trim() || isLoading ? '#ccc' : '#1a2a6c'), 
            color: 'white', fontWeight: 'bold', fontSize: '16px',
            cursor: (stats.count <= 0 || isRecording || !text.trim() || isLoading) ? 'not-allowed' : 'pointer',
            transition: 'background 0.3s ease',
            boxShadow: isRecording ? '0 0 15px rgba(255, 51, 51, 0.5)' : 'none'
          }}
        >
          {isRecording ? '🔴 Ouvindo... Fale agora' : '🎤 PRATICAR PRONÚNCIA'}
        </button>

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
