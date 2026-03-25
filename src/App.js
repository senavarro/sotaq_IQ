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

// --- LEVEL PROGRESSION CURVE ---
const getLevelInfo = (xp) => {
  const thresholds = [0, 500, 1500, 3000, 5000, 8000, 12000, 17000, 23000, 30000];
  let level = 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) level = i + 1;
  }
  const nextTier = thresholds[level] || "MAX";
  return { level, nextTier };
};

export default function QuevedoVIP() {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ count: 12, xp: 0 }); // Updated to 12
  const [text, setText] = useState('');
  const [accent, setAccent] = useState('en-US');
  const [isRecording, setIsRecording] = useState(false);
  const [activeRec, setActiveRec] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
        // Reset to 12 daily
        const { data: updated } = await supabase.from('user_stats').update({ daily_count: 12, last_played_date: today }).eq('email', mail).select().single();
        uStats = updated;
      }
      setStats({ count: uStats.daily_count, xp: uStats.total_xp });
      setUser(mail);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const mail = email.toLowerCase().trim();

    const { data: whitelist } = await supabase.from('allowed_users').select('email').eq('email', mail).single();
    if (!whitelist) { setError('Acesso Negado. E-mail não encontrado na lista VIP.'); return; }

    let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
    
    const today = new Date().toISOString().split('T')[0];
    if (uStats && uStats.last_played_date !== today) {
      // Reset to 12 daily
      const { data: updated } = await supabase.from('user_stats').update({ daily_count: 12, last_played_date: today }).eq('email', mail).select().single();
      uStats = updated;
    }

    localStorage.setItem('quevedo_vip_user', mail);
    setStats({ count: uStats.daily_count, xp: uStats.total_xp });
    setUser(mail);
  };

  const handleLogout = () => {
    localStorage.removeItem('quevedo_vip_user');
    setUser(null); setStats({ count: 12, xp: 0 }); setFeedback(null); setText('');
  };

  const loadRandomWord = async () => {
    setIsLoading(true); setFeedback(null);
    try {
      const response = await fetch('https://random-word-api.herokuapp.com/word?lang=en');
      const data = await response.json();
      setText(data[0].charAt(0).toUpperCase() + data[0].slice(1)); 
    } catch (err) { setText(fallbackWords[Math.floor(Math.random() * fallbackWords.length)]); }
    setIsLoading(false);
  };

  const loadRandomPhrase = async () => {
    setIsLoading(true); setFeedback(null);
    try {
      const response = await fetch('https://dummyjson.com/quotes/random');
      const data = await response.json();
      setText(data.quote);
    } catch (err) { setText(fallbackPhrases[Math.floor(Math.random() * fallbackPhrases.length)]); }
    setIsLoading(false);
  };

  const playAudio = (speed = 1.0) => {
    if (!text) return;
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = accent; utterance.rate = speed; 
    
    const voices = window.speechSynthesis.getVoices();
    const specificVoice = voices.find(voice => voice.lang === accent || voice.lang === accent.replace('-', '_'));
    if (specificVoice) { utterance.voice = specificVoice; }
    window.speechSynthesis.speak(utterance);
  };

  const startPractice = () => {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { alert("⚠️ Microfone não suportado.\n\n📱 iPhone: Use o SAFARI.\n🤖 Android/PC: Use o CHROME."); return; }
    
    const rec = new Speech();
    rec.lang = accent;
    rec.interimResults = false;
    
    setActiveRec(rec); 
    rec.onstart = () => { setIsRecording(true); setFeedback(null); };
    rec.onend = () => { setIsRecording(false); setActiveRec(null); };
    rec.onerror = (event) => {
      setIsRecording(false); setActiveRec(null);
      if (event.error === 'no-speech') { alert("⚠️ Não ouvi nada. Tente falar mais perto do microfone."); } 
      else if (event.error !== 'aborted') { console.error("Erro no microfone:", event.error); }
    };

    rec.onresult = async (e) => {
      const transcript = e.results[0][0].transcript;
      const heardText = transcript.toLowerCase();
      const targetText = text.toLowerCase();

      const cleanHeard = heardText.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      const cleanTarget = targetText.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      
      let accuracy = 0;

      if (cleanHeard === cleanTarget) {
        accuracy = 100;
      } else {
        const targetWords = cleanTarget.split(' ').filter(w => w);
        const heardWords = cleanHeard.split(' ').filter(w => w);

        let matchCount = 0;
        let heardPool = [...heardWords]; 
        
        targetWords.forEach(tWord => { 
          const index = heardPool.findIndex(hWord => {
            return hWord === tWord || 
                   (hWord.length >= 4 && tWord.includes(hWord)) || 
                   (tWord.length >= 4 && hWord.includes(tWord));
          });
          if (index !== -1) {
            matchCount++;
            heardPool.splice(index, 1); 
          }
        });

        let baseAccuracy = 0;
        if (targetWords.length > 0) {
          baseAccuracy = (matchCount / targetWords.length) * 100;
        }

        if (heardPool.length > 0 && targetWords.length > 1) {
          baseAccuracy -= (heardPool.length * 2); 
        }

        accuracy = Math.round(baseAccuracy);
        if (accuracy >= 80 && accuracy < 100) accuracy += 10;
        if (accuracy >= 60 && accuracy < 80) accuracy += 5;
      }

      if (accuracy < 0) accuracy = 0;
      if (accuracy > 100) accuracy = 100;

      let stars = accuracy >= 85 ? 3 : accuracy >= 50 ? 2 : accuracy >= 25 ? 1 : 0;
      
      setFeedback({ stars, score: accuracy, heard: transcript });
      if (stars === 3) confetti({ colors: ['#ff6a00', '#1a2a6c'] });

      const newXP = stats.xp + (stars * 10);
      const newCount = stats.count - 1;
      
      await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
      setStats(prev => ({ ...prev, count: newCount, xp: newXP }));
    };
    rec.start();
  };

  const handleMicClick = () => {
    if (isRecording) {
      if (activeRec) { try { activeRec.stop(); } catch(e) { console.error(e); } }
      setIsRecording(false); setActiveRec(null);
    } else {
      startPractice(); 
    }
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

  const levelInfo = getLevelInfo(stats.xp);

  return (
    <main style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif', position: 'relative' }}>
      
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', boxSizing: 'border-box' }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '20px', maxWidth: '400px', width: '100%', position: 'relative', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#999' }}>✖</button>
            <h3 style={{ color: '#1a2a6c', marginTop: 0 }}>Como Funciona?</h3>
            <ul style={{ paddingLeft: '20px', color: '#444', lineHeight: '1.6', fontSize: '0.95rem' }}>
              <li style={{ marginBottom: '10px' }}><strong>Pratique:</strong> Gere uma frase/palavra ou digite a sua. Aperte em "Ouvir Pronúncia" para pegar o jeito.</li>
              <li style={{ marginBottom: '10px' }}><strong>Grave:</strong> Aperte "Praticar Pronúncia". Fale de forma clara e natural. Quando terminar, aperte para <strong>parar</strong>.</li>
              <li style={{ marginBottom: '10px' }}><strong>Energia:</strong> Você recebe ⚡12 energias por dia. Cada gravação consome 1.</li>
              <li style={{ marginBottom: '10px' }}><strong>XP e Níveis:</strong> O algoritmo de Inteligência Artificial avalia sua fala. Você ganha até 30 XP por acerto. Junte XP para subir de nível!</li>
            </ul>
            <button onClick={() => setIsModalOpen(false)} style={{ width: '100%', background: '#ff6a00', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: 'bold', marginTop: '15px', cursor: 'pointer' }}>Bora Praticar!</button>
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
           <p style={{ margin: 0, fontWeight: '900', color: '#1a2a6c', fontSize: '1.2rem' }}>Nível {levelInfo.level}</p>
           <p style={{ margin: 0, fontSize: '0.8rem', color: '#777', fontWeight: 'bold' }}>XP: {stats.xp} {levelInfo.nextTier !== "MAX" ? `/ ${levelInfo.nextTier}` : ''}</p>
           <p style={{ margin: '5px 0 0 0', color: '#ff6a00', fontWeight: 'bold', fontSize: '0.9rem' }}>⚡ Energia: {stats.count}/12</p>
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

        <textarea 
          placeholder="Escreva algo em inglês ou use os botões acima..." 
          value={isLoading ? "Buscando no dicionário..." : text} 
          onChange={e => setText(e.target.value)}
          disabled={isLoading || isRecording}
          style={{ width: '100%', height: '100px', padding: '15px', borderRadius: '12px', border: '2px solid #eee', marginBottom: '15px', boxSizing: 'border-box', fontSize: '16px', resize: 'vertical' }}
        />

        {text && !isLoading && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '25px' }}>
            <button onClick={() => playAudio(1.0)} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: '#f0f4f8', border: '1px solid #cce0f5', color: '#1a2a6c', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              🔊 Ouvir Pronúncia
            </button>
            <button onClick={() => playAudio(0.5)} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: '#e6f7ff', border: '1px solid #bae0ff', color: '#0284c7', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              🐢 Ouvir Devagar
            </button>
          </div>
        )}
        
        <div style={{ display: 'flex', gap: '15px', marginBottom: '25px' }}>
          <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: accent === 'en-US' ? '2px solid #ff6a00' : '2px solid #eee', background: accent === 'en-US' ? '#fff5eb' : 'white', fontWeight: 'bold', cursor: 'pointer' }}>🇺🇸 Americano</button>
          <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: accent === 'en-GB' ? '2px solid #1a2a6c' : '2px solid #eee', background: accent === 'en-GB' ? '#f0f4f8' : 'white', fontWeight: 'bold', cursor: 'pointer' }}>🇬🇧 Britânico</button>
        </div>

        <button 
          onClick={handleMicClick} 
          disabled={stats.count <= 0 || (!isRecording && (!text.trim() || isLoading))}
          style={{ 
            width: '100%', padding: '18px', borderRadius: '50px', border: 'none', 
            background: isRecording ? '#ff3333' : (stats.count <= 0 || !text.trim() || isLoading ? '#ccc' : '#1a2a6c'), 
            color: 'white', fontWeight: 'bold', fontSize: '16px',
            cursor: (stats.count <= 0 || (!isRecording && (!text.trim() || isLoading))) ? 'not-allowed' : 'pointer',
            transition: 'background 0.3s ease',
            boxShadow: isRecording ? '0 0 15px rgba(255, 51, 51, 0.5)' : 'none'
          }}
        >
          {isRecording ? '🔴 Ouvindo... CLIQUE PARA PARAR' : '🎤 PRATICAR PRONÚNCIA'}
        </button>

        {feedback && (
          <div style={{ marginTop: '25px', textAlign: 'center', padding: '15px', background: '#f9f9f9', borderRadius: '12px' }}>
            <div style={{ fontSize: '2.5rem', color: '#ff6a00', letterSpacing: '5px' }}>{'★'.repeat(feedback.stars)}</div>
            <p style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#1a2a6c', margin: '10px 0' }}>Precisão: {feedback.score}%</p>
            <p style={{ fontSize: '0.9rem', color: '#666', fontStyle: 'italic', margin: 0 }}>Ouvimos: "{feedback.heard}"</p>
            <p style={{ fontSize: '0.85rem', color: '#ff6a00', fontWeight: 'bold', marginTop: '10px' }}>
               +{feedback.stars * 10} XP
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
