import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';
import { curatedPhrases } from './phraseBank'; 

const getLevelInfo = (xp) => {
  const thresholds = [0, 500, 1500, 3000, 5000, 8000, 12000, 17000, 23000, 30000, 40000, 55000, 70000];
  let level = 1;
  let currentMin = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) { level = i + 1; currentMin = thresholds[i]; }
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
  const [loginError, setLoginError] = useState('');
  const [stats, setStats] = useState({ count: 12, xp: 0 });
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState(''); // NEW: Translation State
  const [accent, setAccent] = useState('en-US');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); 
  const [activeRec, setActiveRec] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false); 
  const [isEnergyModalOpen, setIsEnergyModalOpen] = useState(false); 
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
    setLoginError('');
    const mail = email.toLowerCase().trim();
    const { data: whitelist } = await supabase.from('allowed_users').select('email').eq('email', mail).single();
    if (!whitelist) { setLoginError('E-mail não autorizado.'); return; }
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
    setUser(null); setStats({ count: 12, xp: 0 }); setFeedback(null); setText(''); setTranslation(''); setCompletedText('');
  };

  const handleTextChange = (newText) => {
    setText(newText);
    setTranslation(''); // Clear translation if they type manually
    if (newText !== completedText) setCompletedText('');
  };

  // NEW: Robust Loader for Translations
  const loadRandomPhrase = () => {
    setFeedback(null); setCompletedText('');
    const item = curatedPhrases[Math.floor(Math.random() * curatedPhrases.length)];
    
    // Checks if your phraseBank uses objects {en: "...", pt: "..."} or just strings
    if (typeof item === 'object' && item !== null) {
      setText(item.en || item.text || '');
      setTranslation(item.pt || item.translation || '');
    } else {
      setText(item);
      setTranslation('');
    }
  };

  const playAudio = (speed = 1.0) => {
    if (!text) return;
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = accent; 
    utterance.rate = speed; 
    
    const voices = window.speechSynthesis.getVoices();
    let specificVoice;
    
    if (accent === 'en-US') {
      specificVoice = voices.find(v => v.lang === 'en-US' || v.lang === 'en_US' || v.name.includes('United States') || v.name.includes('US') || v.name.includes('American'));
    } else {
      specificVoice = voices.find(v => v.lang === 'en-GB' || v.lang === 'en_GB' || v.name.includes('United Kingdom') || v.name.includes('GB') || v.name.includes('UK') || v.name.includes('British'));
    }
    if (!specificVoice) specificVoice = voices.find(voice => voice.lang === accent || voice.lang === accent.replace('-', '_'));
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
    rec.onerror = () => { setIsRecording(false); setIsProcessing(false); setActiveRec(null); };
    
    rec.onresult = async (e) => {
      setIsProcessing(true); 
      setIsRecording(false);
      
      const transcript = e.results[0][0].transcript;
      const confidence = e.results[0][0].confidence;
      
      const cleanHeard = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      const cleanTarget = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      
      let finalScore = 0;

      if (cleanHeard === cleanTarget) {
        if (confidence >= 0.96) finalScore = Math.round(95 + ((confidence - 0.96) * 125)); 
        else if (confidence >= 0.90) finalScore = Math.round(80 + ((confidence - 0.90) * 150)); 
        else if (confidence >= 0.80) finalScore = Math.round(60 + ((confidence - 0.80) * 200)); 
        else finalScore = Math.round(confidence * 60); 
      } else {
        const targetWords = cleanTarget.split(' ').filter(w => w);
        const heardWords = cleanHeard.split(' ').filter(w => w);

        let matchCount = 0;
        let heardPool = [...heardWords]; 
        targetWords.forEach(tWord => { 
          const index = heardPool.indexOf(tWord);
          if (index !== -1) { matchCount++; heardPool.splice(index, 1); }
        });

        let baseScore = targetWords.length > 0 ? (matchCount / targetWords.length) * 100 : 0;
        let charDiff = Math.abs(cleanHeard.length - cleanTarget.length);
        baseScore -= charDiff; 
        
        if (heardWords.length > targetWords.length) baseScore -= ((heardWords.length - targetWords.length) * 10); 
        baseScore *= Math.pow(confidence, 2.2); 
        
        finalScore = Math.round(Math.max(0, baseScore));
        if (finalScore > 85) finalScore = 85; 
      }

      let stars = finalScore >= 90 ? 3 : finalScore >= 70 ? 2 : finalScore >= 40 ? 1 : 0;
      
      // NEW: Intelligent Feedback Messaging
      let aiMessage = "";
      if (finalScore >= 95) aiMessage = "Perfeito! Sotaque impecável. 🔥";
      else if (finalScore >= 85) aiMessage = "Excelente! Quase um nativo. 🌟";
      else if (finalScore >= 70) aiMessage = "Muito bom, mas a IA notou um sotaque forte. Atenção aos detalhes.";
      else if (finalScore >= 40) aiMessage = "Pronúncia confusa. Foque nas vogais e no ritmo. 🐢";
      else aiMessage = "A IA não conseguiu entender. Tente falar mais devagar.";

      setTimeout(async () => {
        if (stars >= 3) setCompletedText(text);
        setFeedback({ stars, score: finalScore, heard: transcript, message: aiMessage });
        if (stars === 3) confetti({ colors: ['#ff6a00', '#1a2a6c'] });

        const newXP = stats.xp + (stars * 10);
        const newCount = stats.count - 1;
        await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
        setStats(prev => ({ ...prev, count: newCount, xp: newXP }));
        setIsProcessing(false); 
      }, 1500); 
    };
    rec.start();
  };

  const isCompleted = completedText === text && text !== '';

  const handleMainAction = () => {
    if (isProcessing) return; 
    if (isCompleted) { loadRandomPhrase(); return; }
    if (stats.count <= 0 && !isRecording) { setIsEnergyModalOpen(true); return; }

    if (isRecording) {
      setIsProcessing(true); 
      if (activeRec) { try { activeRec.stop(); } catch(e) {} }
      setIsRecording(false);
    } else {
      startPractice(); 
    }
  };

  // --- NEW PREMIUM LOGIN SCREEN ---
  if (!user) {
    return (
      <main style={{ background: 'linear-gradient(135deg, #0f172a, #1a2a6c)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.95)', padding: '40px 30px', borderRadius: '32px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', textAlign: 'center', maxWidth: '400px', width: '100%', backdropFilter: 'blur(10px)' }}>
           <div style={{ background: 'linear-gradient(135deg, #1a2a6c, #ff6a00)', color: 'white', width: '70px', height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '20px', margin: '0 auto 24px', fontWeight: '900', fontSize: '32px', boxShadow: '0 10px 15px -3px rgba(255, 106, 0, 0.3)' }}>Q</div>
           <h2 style={{ color: '#0f172a', marginBottom: '4px', fontSize: '1.8rem', fontWeight: '900', letterSpacing: '-0.5px' }}>SotaQ AI</h2>
           <p style={{ color: '#64748b', marginBottom: '30px', fontSize: '0.9rem' }}>by Idiomas Quevedo</p>
           
           <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
             <div>
               <input type="email" placeholder="E-mail de Acesso" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '16px', border: '2px solid #e2e8f0', borderRadius: '16px', fontSize: '16px', outline: 'none', transition: 'border 0.3s', boxSizing: 'border-box' }} required onFocus={(e) => e.target.style.borderColor = '#1a2a6c'} onBlur={(e) => e.target.style.borderColor = '#e2e8f0'} />
             </div>
             {loginError && <p style={{ color: '#ef4444', margin: '0', fontSize: '0.9rem', fontWeight: '600' }}>{loginError}</p>}
             <button type="submit" style={{ background: '#1a2a6c', color: 'white', border: 'none', padding: '18px', borderRadius: '16px', fontWeight: '900', width: '100%', fontSize: '1.1rem', cursor: 'pointer', boxShadow: '0 4px 14px rgba(26, 42, 108, 0.3)', transition: 'transform 0.1s' }} onMouseDown={(e) => e.target.style.transform = 'scale(0.98)'} onMouseUp={(e) => e.target.style.transform = 'scale(1)'}>
               ENTRAR
             </button>
           </form>
        </div>
      </main>
    );
  }

  const levelInfo = getLevelInfo(stats.xp);

  // --- NEW PREMIUM APP UI ---
  return (
    <main style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', paddingBottom: '60px' }}>
      
      {/* MODALS REMAIN THE SAME, OMITTED FROM EXPLANATION FOR BREVITY BUT INCLUDED IN CODE */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '15px', backdropFilter: 'blur(8px)', boxSizing: 'border-box' }}>
          <div style={{ background: 'white', padding: '28px', borderRadius: '28px', maxWidth: '420px', width: '100%', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: '#f1f5f9', border: 'none', width: '32px', height: '32px', borderRadius: '50%', fontSize: '14px', cursor: 'pointer', color: '#64748b' }}>✕</button>
            <h2 style={{ color: '#0f172a', marginTop: 0, fontSize: '1.4rem', fontWeight: '900' }}>Manual do SotaQ 🎓</h2>
            <div style={{ textAlign: 'left', marginTop: '15px' }}>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🎲</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>Gere o Desafio</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Carregue frases reais de conversação.</p></div></div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🇺🇸</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>Sotaque</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>O Strict Mode avalia sua precisão regional (US/UK).</p></div></div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🎤</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>Pratique e Pare</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Toque para gravar e **toque para encerrar**.</p></div></div>
              <div style={{ display: 'flex', gap: '12px' }}><span style={{ fontSize: '1.3rem' }}>⚡</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>Energia</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Você tem 12 energias por dia. Renova à meia-noite.</p></div></div>
            </div>
            <button onClick={() => setIsModalOpen(false)} style={{ width: '100%', background: '#1a2a6c', color: 'white', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: '900', marginTop: '20px', cursor: 'pointer', fontSize: '1rem' }}>ESTOU PRONTO</button>
          </div>
        </div>
      )}

      {isEnergyModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ background: 'white', padding: '35px', borderRadius: '28px', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '15px' }}>⚡</div>
            <h2 style={{ color: '#0f172a', margin: '0 0 10px 0', fontWeight: '900' }}>Bateria Esgotada!</h2>
            <p style={{ color: '#64748b', lineHeight: '1.6', marginBottom: '25px', fontSize: '0.95rem' }}>Excelente dedicação! <br/> Sua energia recarrega <b>à meia-noite</b>.</p>
            <button onClick={() => setIsEnergyModalOpen(false)} style={{ width: '100%', background: '#1a2a6c', color: 'white', padding: '16px', borderRadius: '14px', fontWeight: '900', border: 'none', cursor: 'pointer' }}>FECHAR</button>
          </div>
        </div>
      )}

      {/* HEADER - MINIMALIST */}
      <header style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '800px', margin: '0 auto' }}>
        <div>
          <h1 style={{ color: '#1a2a6c', margin: 0, fontSize: '1.2rem', fontWeight: '900', letterSpacing: '-0.5px' }}>SotaQ AI</h1>
          <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
            <button onClick={() => setIsModalOpen(true)} disabled={isProcessing} style={{ background: 'none', border: 'none', color: '#ff6a00', padding: 0, fontSize: '0.8rem', fontWeight: '800', cursor: 'pointer' }}>Regras</button>
            <button onClick={handleLogout} disabled={isProcessing} style={{ background: 'none', border: 'none', color: '#94a3b8', padding: 0, fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}>Sair</button>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'white', padding: '6px 12px', borderRadius: '50px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <span style={{ fontSize: '1.1rem' }}>⚡</span>
            <span style={{ color: '#1a2a6c', fontWeight: '900', fontSize: '0.9rem' }}>{stats.count}/12</span>
           </div>
        </div>
      </header>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 20px' }}>
        
        {/* LEVEL PROGRESS */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
            <p style={{ margin: 0, fontWeight: '900', color: '#0f172a', fontSize: '1rem' }}>Lvl {levelInfo.level}</p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', fontWeight: '600' }}>
              {stats.xp} XP {levelInfo.nextTier !== "MAX" && <span style={{color: '#ff6a00'}}>({levelInfo.pointsToNext} to go)</span>}
            </p>
          </div>
          <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '50px', overflow: 'hidden' }}>
            <div style={{ width: `${levelInfo.progress}%`, height: '100%', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)', transition: 'width 0.5s ease' }} />
          </div>
        </div>

        {/* ACCENT TOGGLE */}
        <div style={{ display: 'flex', background: 'white', borderRadius: '16px', padding: '6px', marginBottom: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
          <button onClick={() => setAccent('en-US')} disabled={isProcessing} style={{ flex: 1, padding: '10px', borderRadius: '12px', background: accent === 'en-US' ? '#1a2a6c' : 'transparent', color: accent === 'en-US' ? 'white' : '#64748b', fontWeight: '800', border: 'none', cursor: isProcessing ? 'not-allowed' : 'pointer', transition: 'all 0.3s ease', fontSize: '0.9rem' }}>🇺🇸 American</button>
          <button onClick={() => setAccent('en-GB')} disabled={isProcessing} style={{ flex: 1, padding: '10px', borderRadius: '12px', background: accent === 'en-GB' ? '#1a2a6c' : 'transparent', color: accent === 'en-GB' ? 'white' : '#64748b', fontWeight: '800', border: 'none', cursor: isProcessing ? 'not-allowed' : 'pointer', transition: 'all 0.3s ease', fontSize: '0.9rem' }}>🇬🇧 British</button>
        </div>

        {/* MAIN AI CARD */}
        <div style={{ background: 'white', borderRadius: '24px', padding: '24px', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.08)', marginBottom: '24px', position: 'relative' }}>
          
          <button onClick={loadRandomPhrase} disabled={isRecording || isProcessing} style={{ position: 'absolute', top: '-16px', left: '50%', transform: 'translateX(-50%)', background: '#ff6a00', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '50px', fontWeight: '900', cursor: (isRecording || isProcessing) ? 'not-allowed' : 'pointer', fontSize: '0.85rem', boxShadow: '0 4px 10px rgba(255, 106, 0, 0.3)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '1.1rem' }}>🎲</span> Nova Frase
          </button>

          <textarea 
            value={text} 
            onChange={e => handleTextChange(e.target.value)}
            disabled={isRecording || isCompleted || isProcessing}
            placeholder="Gere uma frase para começar..."
            style={{ width: '100%', minHeight: '80px', border: 'none', fontSize: '1.4rem', fontWeight: '700', color: '#0f172a', textAlign: 'center', resize: 'none', background: 'transparent', outline: 'none', marginTop: '16px', fontFamily: 'inherit' }}
          />

          {/* NEW: Translation Block */}
          {translation && (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.95rem', margin: '0 0 20px 0', fontWeight: '500' }}>
              🇧🇷 "{translation}"
            </p>
          )}

          {text && (
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '10px' }}>
              <button onClick={() => playAudio(1.0)} disabled={isProcessing} style={{ background: '#f1f5f9', color: '#1a2a6c', border: 'none', padding: '10px 20px', borderRadius: '50px', fontWeight: '800', cursor: isProcessing ? 'not-allowed' : 'pointer', fontSize: '0.9rem' }}>🔊 Normal</button>
              <button onClick={() => playAudio(0.5)} disabled={isProcessing} style={{ background: '#f1f5f9', color: '#1a2a6c', border: 'none', padding: '10px 20px', borderRadius: '50px', fontWeight: '800', cursor: isProcessing ? 'not-allowed' : 'pointer', fontSize: '0.9rem' }}>🐢 Lento</button>
            </div>
          )}
        </div>

        {/* FEEDBACK BLOCK */}
        {feedback && !isProcessing && (
          <div style={{ textAlign: 'center', padding: '24px', background: feedback.stars === 3 ? '#ecfdf5' : feedback.stars === 2 ? '#fffbeb' : '#fef2f2', borderRadius: '24px', marginBottom: '24px', border: `1px solid ${feedback.stars === 3 ? '#a7f3d0' : feedback.stars === 2 ? '#fde68a' : '#fecaca'}` }}>
            <div style={{ fontSize: '2.5rem', color: feedback.stars === 3 ? '#10b981' : feedback.stars === 2 ? '#f59e0b' : '#ef4444', marginBottom: '8px' }}>
              {'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}
            </div>
            <p style={{ fontWeight: '900', fontSize: '1.4rem', margin: '0 0 4px 0', color: '#0f172a' }}>{feedback.score}%</p>
            <p style={{ color: '#1e293b', fontWeight: '700', fontSize: '1rem', margin: '0 0 8px 0' }}>{feedback.message}</p>
            <p style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.85rem', margin: 0 }}>Ouvimos: "{feedback.heard}"</p>
          </div>
        )}

        {/* MAIN ACTION BUTTON */}
        <button 
          onClick={handleMainAction} 
          disabled={isProcessing || (!isRecording && !text.trim() && !isCompleted)}
          style={{ 
            width: '100%', padding: '20px', borderRadius: '20px', border: 'none', 
            background: isProcessing ? '#f59e0b' : isRecording ? '#ef4444' : isCompleted ? '#ff6a00' : '#1a2a6c', 
            color: 'white', fontWeight: '900', fontSize: '1.1rem', 
            cursor: (isProcessing || (!isRecording && !text.trim() && !isCompleted)) ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s',
            boxShadow: isProcessing ? 'none' : isRecording ? '0 10px 25px rgba(239, 68, 68, 0.4)' : isCompleted ? '0 10px 25px rgba(255, 106, 0, 0.4)' : '0 10px 25px rgba(26, 42, 108, 0.3)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'
          }}
        >
          {isProcessing ? '⏳ Analisando pronúncia...' : isRecording ? '🔴 PARAR GRAVAÇÃO' : isCompleted ? '🌟 PERFEITO! NOVA FRASE' : '🎤 PRATICAR PRONÚNCIA'}
        </button>

      </div>
    </main>
  );
}
