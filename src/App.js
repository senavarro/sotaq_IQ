import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';
import { curatedWords, curatedPhrases } from './phraseBank'; // Our custom bank

// --- ADVANCED LEVEL PROGRESSION CURVE ---
const getLevelInfo = (xp) => {
  const thresholds = [0, 500, 1500, 3000, 5000, 8000, 12000, 17000, 23000, 30000, 40000, 55000, 70000];
  let level = 1;
  let currentMin = 0;
  
  for (let i = 0; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) {
      level = i + 1;
      currentMin = thresholds[i];
    }
  }
  
  const isMax = level >= thresholds.length;
  const nextTier = isMax ? currentMin : thresholds[level];
  const progress = isMax ? 100 : ((xp - currentMin) / (nextTier - currentMin)) * 100;
  const pointsToNext = isMax ? 0 : nextTier - xp;

  return { level: isMax ? 13 : level, currentMin, nextTier: isMax ? "MAX" : nextTier, progress, isMax, pointsToNext };
};

export default function QuevedoVIP() {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ count: 12, xp: 0 });
  const [text, setText] = useState('');
  const [accent, setAccent] = useState('en-US');
  const [isRecording, setIsRecording] = useState(false);
  const [activeRec, setActiveRec] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [completedText, setCompletedText] = useState('');

  useEffect(() => {
    const savedEmail = localStorage.getItem('quevedo_vip_user');
    if (savedEmail) restoreSession(savedEmail);
  }, []);

  const restoreSession = async (mail) => {
    let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
    if (uStats) {
      const today = new Date().toISOString().split('T')[0];
      if (uStats.last_played_date !== today) {
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
      const { data: updated } = await supabase.from('user_stats').update({ daily_count: 12, last_played_date: today }).eq('email', mail).select().single();
      uStats = updated;
    }
    localStorage.setItem('quevedo_vip_user', mail);
    setStats({ count: uStats.daily_count, xp: uStats.total_xp });
    setUser(mail);
  };

  const handleLogout = () => {
    localStorage.removeItem('quevedo_vip_user');
    setUser(null); setStats({ count: 12, xp: 0 }); setFeedback(null); setText(''); setCompletedText('');
  };

  const handleTextChange = (newText) => {
    setText(newText);
    if (newText !== completedText) setCompletedText('');
  };

  // --- UPDATED: PULLING FROM LOCAL BANK INSTEAD OF API ---
  const loadRandomWord = () => {
    setFeedback(null); setCompletedText('');
    const randomIndex = Math.floor(Math.random() * curatedWords.length);
    setText(curatedWords[randomIndex]);
  };

  const loadRandomPhrase = () => {
    setFeedback(null); setCompletedText('');
    const randomIndex = Math.floor(Math.random() * curatedPhrases.length);
    setText(curatedPhrases[randomIndex]);
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
          const index = heardPool.findIndex(hWord => hWord === tWord || (hWord.length >= 4 && tWord.includes(hWord)) || (tWord.length >= 4 && hWord.includes(tWord)));
          if (index !== -1) { matchCount++; heardPool.splice(index, 1); }
        });
        let baseAccuracy = targetWords.length > 0 ? (matchCount / targetWords.length) * 100 : 0;
        if (heardPool.length > 0 && targetWords.length > 1) baseAccuracy -= (heardPool.length * 2); 
        accuracy = Math.round(baseAccuracy);
        if (accuracy >= 80 && accuracy < 100) accuracy += 10;
        if (accuracy >= 60 && accuracy < 80) accuracy += 5;
      }
      if (accuracy < 0) accuracy = 0;
      if (accuracy > 100) accuracy = 100;
      let stars = accuracy >= 85 ? 3 : accuracy >= 50 ? 2 : accuracy >= 25 ? 1 : 0;
      if (stars >= 3) setCompletedText(text);
      setFeedback({ stars, score: accuracy, heard: transcript });
      if (stars === 3) confetti({ colors: ['#ff6a00', '#1a2a6c'] });
      const newXP = stats.xp + (stars * 10);
      const newCount = stats.count - 1;
      await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
      setStats(prev => ({ ...prev, count: newCount, xp: newXP }));
    };
    rec.start();
  };

  const isCompleted = completedText === text && text !== '';

  const handleMainAction = () => {
    if (isCompleted) {
      Math.random() > 0.5 ? loadRandomPhrase() : loadRandomWord();
      return;
    }
    if (isRecording) {
      if (activeRec) { try { activeRec.stop(); } catch(e) {} }
      setIsRecording(false); setActiveRec(null);
    } else {
      startPractice(); 
    }
  };

  if (!user) {
    return (
      <main style={{ background: '#f8fafc', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', textAlign: 'center', maxWidth: '400px', width: '90%' }}>
           <div style={{ background: 'linear-gradient(135deg, #1a2a6c, #ff6a00)', color: 'white', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '16px', margin: '0 auto 20px', fontWeight: '900', fontSize: '28px' }}>Q</div>
           <h2 style={{ color: '#0f172a', marginBottom: '8px' }}>VIP Fluency Portal</h2>
           <form onSubmit={handleLogin}>
             <input type="email" placeholder="Seu E-mail VIP" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '16px', marginBottom: '15px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '16px' }} required />
             {error && <p style={{ color: '#ef4444', marginBottom: '15px' }}>{error}</p>}
             <button type="submit" style={{ background: '#ff6a00', color: 'white', border: 'none', padding: '16px', borderRadius: '12px', fontWeight: 'bold', width: '100%', fontSize: '16px' }}>ENTRAR</button>
           </form>
        </div>
      </main>
    );
  }

  const levelInfo = getLevelInfo(stats.xp);

  return (
    <main style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', paddingBottom: '40px' }}>
      
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '24px', maxWidth: '400px', width: '100%', position: 'relative' }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '15px', right: '15px', border: 'none', background: '#f1f5f9', borderRadius: '50%', width: '30px', height: '30px' }}>✖</button>
            <h3 style={{ marginTop: 0 }}>Como Funciona?</h3>
            <ul style={{ paddingLeft: '20px', color: '#475569', lineHeight: '1.6' }}>
              <li><strong>Pratique:</strong> Use os botões no topo para frases reais de conversação.</li>
              <li><strong>Grave:</strong> Aperte e fale. Quando terminar, aperte para <strong>parar</strong>.</li>
              <li><strong>Gamificação:</strong> Ganhe XP e suba até o Nível 13.</li>
              <li><strong>Anti-Spam:</strong> Acertos perfeitos bloqueiam a frase. Gere uma nova!</li>
            </ul>
            <button onClick={() => setIsModalOpen(false)} style={{ width: '100%', background: '#ff6a00', color: 'white', padding: '16px', borderRadius: '12px', fontWeight: 'bold' }}>Vamos lá!</button>
          </div>
        </div>
      )}

      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'white', padding: '15px 20px', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ color: '#1a2a6c', margin: 0, fontSize: '1.1rem', fontWeight: '800' }}>Idiomas Quevedo</h3>
          <div style={{ display: 'flex', gap: '15px' }}>
            <button onClick={() => setIsModalOpen(true)} style={{ background: 'none', color: '#ff6a00', border: 'none', fontSize: '0.85rem', fontWeight: 'bold' }}>Regras</button>
            <button onClick={handleLogout} style={{ background: 'none', color: '#94a3b8', border: 'none', fontSize: '0.85rem' }}>Sair</button>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
           <p style={{ margin: 0, color: '#ff6a00', fontWeight: '900' }}>⚡ {stats.count} / 12</p>
        </div>
      </header>

      <div style={{ background: 'white', padding: '0 20px 20px 20px', borderBottom: '1px solid #e2e8f0', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
          <p style={{ margin: 0, fontWeight: '900', color: '#0f172a', fontSize: '1.2rem' }}>Nível {levelInfo.level}</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
            {stats.xp} XP {levelInfo.nextTier !== "MAX" && <span style={{color: '#ff6a00'}}> (Faltam {levelInfo.pointsToNext} para o Nível {levelInfo.level + 1})</span>}
          </p>
        </div>
        <div style={{ width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
          <div style={{ width: `${levelInfo.progress}%`, height: '100%', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)', borderRadius: '5px', transition: 'width 0.5s ease' }} />
        </div>
      </div>

      <div style={{ padding: '0 20px', maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
          <label style={{ fontWeight: '700', color: '#334155' }}>Escolha o treino:</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={loadRandomWord} style={{ background: '#e0f2fe', color: '#0284c7', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '700' }}>🎲 Palavra</button>
            <button onClick={loadRandomPhrase} style={{ background: '#ffedd5', color: '#ea580c', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '700' }}>🎲 Frase</button>
          </div>
        </div>

        <textarea 
          placeholder="Toque em um dado acima para começar..." 
          value={text} 
          onChange={e => handleTextChange(e.target.value)}
          disabled={isRecording || isCompleted}
          style={{ width: '100%', height: '110px', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '15px', fontSize: '16px', background: isCompleted ? '#f8fafc' : 'white' }}
        />

        {text && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '25px' }}>
            <button onClick={() => playAudio(1.0)} style={{ flex: 1, padding: '14px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', fontWeight: '700' }}>🔊 Ouvir</button>
            <button onClick={() => playAudio(0.5)} style={{ flex: 1, padding: '14px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', fontWeight: '700' }}>🐢 Devagar</button>
          </div>
        )}
        
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '14px', padding: '5px', marginBottom: '30px' }}>
          <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: accent === 'en-US' ? 'white' : 'transparent', fontWeight: '700', border: 'none' }}>🇺🇸 USA</button>
          <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: accent === 'en-GB' ? 'white' : 'transparent', fontWeight: '700', border: 'none' }}>🇬🇧 UK</button>
        </div>

        <button 
          onClick={handleMainAction} 
          disabled={stats.count <= 0 || (!isRecording && !text.trim() && !isCompleted)}
          style={{ 
            width: '100%', padding: '20px', borderRadius: '16px', border: 'none', 
            background: isRecording ? '#ef4444' : isCompleted ? '#ff6a00' : (stats.count <= 0 ? '#cbd5e1' : '#1a2a6c'), 
            color: 'white', fontWeight: '800', fontSize: '1rem',
            boxShadow: isRecording ? '0 0 20px rgba(239, 68, 68, 0.4)' : '0 4px 15px rgba(0,0,0,0.1)'
          }}
        >
          {isRecording ? '🔴 CLIQUE PARA PARAR' : isCompleted ? '🌟 PERFEITO! PRÓXIMA 🎲' : '🎤 PRATICAR PRONÚNCIA'}
        </button>

        {feedback && (
          <div style={{ marginTop: '25px', textAlign: 'center', padding: '20px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px' }}>
            <div style={{ fontSize: '2.5rem', color: '#ff6a00' }}>{'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}</div>
            <p style={{ fontWeight: '800', fontSize: '1.3rem', margin: '10px 0' }}>{feedback.score}%</p>
            <p style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.9rem' }}>Ouvimos: "{feedback.heard}"</p>
            <p style={{ color: '#10b981', fontWeight: '800', marginTop: '10px' }}>+{feedback.stars * 10} XP</p>
          </div>
        )}
      </div>
    </main>
  );
}
