import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';
import { curatedWords, curatedPhrases } from './phraseBank'; 

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
    if (!whitelist) { setError('Acesso Negado.'); return; }
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

  const loadRandomWord = () => {
    setFeedback(null); setCompletedText('');
    setText(curatedWords[Math.floor(Math.random() * curatedWords.length)]);
  };

  const loadRandomPhrase = () => {
    setFeedback(null); setCompletedText('');
    setText(curatedPhrases[Math.floor(Math.random() * curatedPhrases.length)]);
  };

  const playAudio = (speed = 1.0) => {
    if (!text) return;
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = accent; utterance.rate = speed; 
    const voices = window.speechSynthesis.getVoices();
    const specificVoice = voices.find(voice => voice.lang === accent || voice.lang === accent.replace('-', '_'));
    if (specificVoice) utterance.voice = specificVoice;
    window.speechSynthesis.speak(utterance);
  };

  const startPractice = () => {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { alert("Use Safari ou Chrome."); return; }
    const rec = new Speech();
    rec.lang = accent;
    rec.interimResults = false;
    setActiveRec(rec); 
    rec.onstart = () => { setIsRecording(true); setFeedback(null); };
    rec.onend = () => { setIsRecording(false); setActiveRec(null); };
    rec.onresult = async (e) => {
      const transcript = e.results[0][0].transcript;
      const confidence = e.results[0][0].confidence; // Browser's guess on how sure it is
      
      const cleanHeard = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      const cleanTarget = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      
      const targetWords = cleanTarget.split(' ').filter(w => w);
      const heardWords = cleanHeard.split(' ').filter(w => w);

      let matchCount = 0;
      let heardPool = [...heardWords]; 
      
      targetWords.forEach(tWord => { 
        // STRICT: Must be an exact word match now
        const index = heardPool.indexOf(tWord);
        if (index !== -1) {
          matchCount++;
          heardPool.splice(index, 1); 
        }
      });

      // CALCULATE ACCURACY
      let baseScore = targetWords.length > 0 ? (matchCount / targetWords.length) * 100 : 0;
      
      // APPLY CONFIDENCE PENALTY: If browser is unsure, we penalize the score
      if (confidence < 0.90) baseScore *= confidence;

      // HEAVY BABBLE PENALTY: -10% per extra word
      if (heardWords.length > targetWords.length) {
        baseScore -= ((heardWords.length - targetWords.length) * 10);
      }

      let finalScore = Math.round(Math.max(0, baseScore));
      let stars = finalScore >= 90 ? 3 : finalScore >= 70 ? 2 : finalScore >= 40 ? 1 : 0;
      
      if (stars >= 3) setCompletedText(text);
      setFeedback({ stars, score: finalScore, heard: transcript });
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
      setIsRecording(false);
    } else {
      startPractice(); 
    }
  };

  if (!user) {
    return (
      <main style={{ background: '#f8fafc', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)', textAlign: 'center', maxWidth: '400px', width: '90%' }}>
           <h2 style={{ color: '#0f172a' }}>VIP Portal</h2>
           <form onSubmit={handleLogin}>
             <input type="email" placeholder="Seu E-mail VIP" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '16px', marginBottom: '15px', border: '1px solid #e2e8f0', borderRadius: '12px' }} required />
             <button type="submit" style={{ background: '#ff6a00', color: 'white', padding: '16px', borderRadius: '12px', width: '100%', fontWeight: 'bold' }}>ENTRAR</button>
           </form>
        </div>
      </main>
    );
  }

  const levelInfo = getLevelInfo(stats.xp);

  return (
    <main style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', paddingBottom: '40px' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'white', padding: '15px 20px', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ color: '#1a2a6c', margin: 0, fontSize: '1.1rem', fontWeight: '800' }}>Idiomas Quevedo</h3>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.8rem', padding: 0 }}>Sair</button>
        </div>
        <div style={{ textAlign: 'right' }}>
           <p style={{ margin: 0, color: '#ff6a00', fontWeight: '900' }}>⚡ {stats.count} / 12</p>
        </div>
      </header>

      <div style={{ background: 'white', padding: '0 20px 20px 20px', borderBottom: '1px solid #e2e8f0', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
          <p style={{ margin: 0, fontWeight: '900', color: '#0f172a', fontSize: '1.2rem' }}>Nível {levelInfo.level}</p>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
            {stats.xp} XP {levelInfo.nextTier !== "MAX" && <span style={{color: '#ff6a00'}}> (Faltam {levelInfo.pointsToNext} para Lvl {levelInfo.level + 1})</span>}
          </p>
        </div>
        <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ width: `${levelInfo.progress}%`, height: '100%', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)', transition: 'width 0.5s ease' }} />
        </div>
      </div>

      <div style={{ padding: '0 20px', maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={loadRandomWord} style={{ background: '#e0f2fe', color: '#0284c7', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '700' }}>🎲 Palavra</button>
            <button onClick={loadRandomPhrase} style={{ background: '#ffedd5', color: '#ea580c', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '700' }}>🎲 Frase</button>
          </div>
        </div>

        <textarea 
          value={text} 
          onChange={e => handleTextChange(e.target.value)}
          disabled={isRecording || isCompleted}
          style={{ width: '100%', height: '100px', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '15px', fontSize: '16px', background: isCompleted ? '#f8fafc' : 'white' }}
        />

        {text && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => playAudio(1.0)} style={{ flex: 1, padding: '12px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', fontWeight: '700' }}>🔊 Ouvir</button>
            <button onClick={() => playAudio(0.5)} style={{ flex: 1, padding: '12px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', fontWeight: '700' }}>🐢 Devagar</button>
          </div>
        )}
        
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '14px', padding: '4px', marginBottom: '25px' }}>
          <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '10px', borderRadius: '10px', background: accent === 'en-US' ? 'white' : 'transparent', fontWeight: '700', border: 'none' }}>🇺🇸 USA</button>
          <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '10px', borderRadius: '10px', background: accent === 'en-GB' ? 'white' : 'transparent', fontWeight: '700', border: 'none' }}>🇬🇧 UK</button>
        </div>

        <button 
          onClick={handleMainAction} 
          disabled={stats.count <= 0 || (!isRecording && !text.trim() && !isCompleted)}
          style={{ 
            width: '100%', padding: '18px', borderRadius: '16px', border: 'none', 
            background: isRecording ? '#ef4444' : isCompleted ? '#ff6a00' : (stats.count <= 0 ? '#cbd5e1' : '#1a2a6c'), 
            color: 'white', fontWeight: '800', fontSize: '1rem'
          }}
        >
          {isRecording ? '🔴 CLIQUE PARA PARAR' : isCompleted ? '🌟 PERFEITO! PRÓXIMA 🎲' : '🎤 PRATICAR PRONÚNCIA'}
        </button>

        {feedback && (
          <div style={{ marginTop: '20px', textAlign: 'center', padding: '20px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px' }}>
            <div style={{ fontSize: '2.5rem', color: '#ff6a00' }}>{'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}</div>
            <p style={{ fontWeight: '800', fontSize: '1.2rem', margin: '5px 0' }}>Precisão: {feedback.score}%</p>
            <p style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.85rem' }}>Ouvimos: "{feedback.heard}"</p>
          </div>
        )}
      </div>
    </main>
  );
}
