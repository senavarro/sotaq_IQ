import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';
import { curatedPhrases } from './phraseBank'; 

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
  const [loginError, setLoginError] = useState('');
  const [stats, setStats] = useState({ count: 12, xp: 0 });
  const [text, setText] = useState('');
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
    setUser(null); setStats({ count: 12, xp: 0 }); setFeedback(null); setText(''); setCompletedText('');
  };

  const handleTextChange = (newText) => {
    setText(newText);
    if (newText !== completedText) setCompletedText('');
  };

  const loadRandomPhrase = () => {
    setFeedback(null); setCompletedText('');
    setText(curatedPhrases[Math.floor(Math.random() * curatedPhrases.length)]);
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

    if (!specificVoice) {
      specificVoice = voices.find(voice => voice.lang === accent || voice.lang === accent.replace('-', '_'));
    }

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
    rec.onend = () => { 
      setIsRecording(false); 
      setActiveRec(null); 
    };
    rec.onerror = () => {
      setIsRecording(false);
      setIsProcessing(false);
      setActiveRec(null);
    };
    
    rec.onresult = async (e) => {
      setIsProcessing(true); 
      setIsRecording(false);
      
      const transcript = e.results[0][0].transcript;
      const confidence = e.results[0][0].confidence;
      
      const cleanHeard = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      const cleanTarget = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      
      let finalScore = 0;

      // --- THE NATIVE GATEKEEPER ALGORITHM ---
      if (cleanHeard === cleanTarget) {
        // EXACT MATCH: They got all the words. Now we judge the accent strictly by AI doubt.
        if (confidence >= 0.96) {
          finalScore = Math.round(95 + ((confidence - 0.96) * 125)); // Perfect native (95-100%)
        } else if (confidence >= 0.90) {
          finalScore = Math.round(80 + ((confidence - 0.90) * 150)); // Good, but slight accent (80-89%)
        } else if (confidence >= 0.80) {
          finalScore = Math.round(60 + ((confidence - 0.80) * 200)); // Wrong accent / Muddy (60-79%)
        } else {
          finalScore = Math.round(confidence * 60); // Guessed right, but sounded terrible (< 50%)
        }
      } else {
        // NOT AN EXACT MATCH: The accent caused a spelling mistake.
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
        
        if (heardWords.length > targetWords.length) {
          baseScore -= ((heardWords.length - targetWords.length) * 10); 
        }

        baseScore *= Math.pow(confidence, 2.2); 
        finalScore = Math.round(Math.max(0, baseScore));
        
        // THE PERFECTION CAP: You cannot score higher than 85% if there's a single mistake.
        if (finalScore > 85) finalScore = 85; 
      }

      let stars = finalScore >= 90 ? 3 : finalScore >= 70 ? 2 : finalScore >= 40 ? 1 : 0;
      
      setTimeout(async () => {
        if (stars >= 3) setCompletedText(text);
        setFeedback({ stars, score: finalScore, heard: transcript });
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
    
    if (isCompleted) {
      loadRandomPhrase();
      return;
    }
    
    if (stats.count <= 0 && !isRecording) {
      setIsEnergyModalOpen(true);
      return;
    }

    if (isRecording) {
      setIsProcessing(true); 
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
           <div style={{ background: 'linear-gradient(135deg, #1a2a6c, #ff6a00)', color: 'white', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '16px', margin: '0 auto 20px', fontWeight: '900', fontSize: '28px' }}>Q</div>
           <h2 style={{ color: '#0f172a', marginBottom: '8px' }}>SotaQ by Idiomas Quevedo</h2>
           <form onSubmit={handleLogin}>
             <input type="email" placeholder="Seu E-mail" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '16px', marginBottom: '15px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '16px' }} required />
             {loginError && <p style={{ color: '#ef4444', marginBottom: '15px', fontSize: '0.9rem' }}>{loginError}</p>}
             <button type="submit" style={{ background: '#ff6a00', color: 'white', border: 'none', padding: '16px', borderRadius: '12px', fontWeight: 'bold', width: '100%', fontSize: '16px', cursor: 'pointer' }}>ENTRAR</button>
           </form>
        </div>
      </main>
    );
  }

  const levelInfo = getLevelInfo(stats.xp);

  return (
    <main style={{ background: '#f8fafc', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', paddingBottom: '40px' }}>
      
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '15px', backdropFilter: 'blur(8px)', boxSizing: 'border-box' }}>
          <div style={{ background: 'white', padding: '28px', borderRadius: '28px', maxWidth: '420px', width: '100%', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #e2e8f0', maxHeight: '90vh', overflowY: 'auto' }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: '#f1f5f9', border: 'none', width: '32px', height: '32px', borderRadius: '50%', fontSize: '14px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            <h2 style={{ color: '#0f172a', marginTop: 0, fontSize: '1.4rem', fontWeight: '900', letterSpacing: '-0.5px' }}>Manual do SotaQ 🎓</h2>
            <div style={{ textAlign: 'left', marginTop: '15px' }}>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🎲</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>1. Gere o Desafio</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Carregue frases reais de conversação.</p></div></div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🇺🇸</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>2. Escolha seu Sotaque</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Alterne entre USA e UK. A IA mudará a "orelha" para validar sua pronúncia específica.</p></div></div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🔊</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>3. Ouça a Referência</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Escute no modo Normal ou Tartaruga para pegar os detalhes.</p></div></div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🎤</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>4. Pratique e Pare</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Toque para gravar e **toque novamente para encerrar**. O Strict Mode não perdoa erros!</p></div></div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}><span style={{ fontSize: '1.3rem' }}>🏆</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>5. Ganhe XP e Bloqueie</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Acertos perfeitos (3★) bloqueiam a frase. Se já dominou, evolua!</p></div></div>
              <div style={{ display: 'flex', gap: '12px' }}><span style={{ fontSize: '1.3rem' }}>⚡</span><div><p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>6. Energia Diária</p><p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Você tem 12 energias por dia. Use cada uma com foco total.</p></div></div>
            </div>
            <button onClick={() => setIsModalOpen(false)} style={{ width: '100%', background: 'linear-gradient(135deg, #1a2a6c, #1a2a6c)', color: 'white', border: 'none', padding: '16px', borderRadius: '14px', fontWeight: '900', marginTop: '20px', cursor: 'pointer', fontSize: '1rem', boxShadow: '0 10px 15px -3px rgba(26, 42, 108, 0.3)' }}>ESTOU PRONTO</button>
          </div>
        </div>
      )}

      {isEnergyModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ background: 'white', padding: '35px', borderRadius: '28px', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '15px' }}>⚡</div>
            <h2 style={{ color: '#0f172a', margin: '0 0 10px 0', fontWeight: '900' }}>Bateria Esgotada!</h2>
            <p style={{ color: '#64748b', lineHeight: '1.6', marginBottom: '25px', fontSize: '0.95rem' }}>
              Você completou todos os seus 12 treinos diários. Excelente dedicação! <br/><br/> Sua energia será recarregada automaticamente <b>à meia-noite</b>. Volte amanhã!
            </p>
            <button onClick={() => setIsEnergyModalOpen(false)} style={{ width: '100%', background: '#1a2a6c', color: 'white', padding: '16px', borderRadius: '14px', fontWeight: '900', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>FECHAR</button>
          </div>
        </div>
      )}

      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'white', padding: '12px 20px', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ color: '#1a2a6c', margin: 0, fontSize: '1.05rem', fontWeight: '900', letterSpacing: '-0.5px' }}>SotaQ - Idiomas Quevedo</h3>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => setIsModalOpen(true)} disabled={isProcessing} style={{ background: '#e6f0ff', border: '1px solid #cce0ff', color: '#1a2a6c', padding: '6px 12px', borderRadius: '50px', fontSize: '0.75rem', fontWeight: '800', cursor: isProcessing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>❓ Regras</button>
            <button onClick={handleLogout} disabled={isProcessing} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#94a3b8', padding: '6px 12px', borderRadius: '50px', fontSize: '0.75rem', fontWeight: '700', cursor: isProcessing ? 'not-allowed' : 'pointer' }}>Sair</button>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
           <div style={{ background: '#e6f0ff', padding: '8px 12px', borderRadius: '12px', border: '1px solid #cce0ff' }}>
            <p style={{ margin: 0, color: '#1a2a6c', fontWeight: '900', fontSize: '0.9rem' }}>⚡ {stats.count} / 12</p>
           </div>
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
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '15px' }}>
            <button onClick={loadRandomPhrase} disabled={isRecording || isProcessing} style={{ width: '100%', background: '#ffedd5', color: '#ea580c', border: 'none', padding: '12px 14px', borderRadius: '16px', fontWeight: '800', cursor: (isRecording || isProcessing) ? 'not-allowed' : 'pointer', fontSize: '1rem' }}>🎲 Gerar Nova Frase</button>
        </div>

        <textarea 
          value={text} 
          onChange={e => handleTextChange(e.target.value)}
          disabled={isRecording || isCompleted || isProcessing}
          placeholder="Gere uma frase acima para começar..."
          style={{ width: '100%', height: '100px', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '15px', fontSize: '16px', background: isCompleted ? '#f8fafc' : 'white', fontFamily: 'inherit' }}
        />

        {text && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => playAudio(1.0)} disabled={isProcessing} style={{ flex: 1, padding: '12px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', fontWeight: '700', cursor: isProcessing ? 'not-allowed' : 'pointer' }}>🔊 Ouvir</button>
            <button onClick={() => playAudio(0.5)} disabled={isProcessing} style={{ flex: 1, padding: '12px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', fontWeight: '700', cursor: isProcessing ? 'not-allowed' : 'pointer' }}>🐢 Devagar</button>
          </div>
        )}
        
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '16px', padding: '6px', marginBottom: '25px', border: '1px solid #e2e8f0' }}>
          <button onClick={() => setAccent('en-US')} disabled={isProcessing} style={{ flex: 1, padding: '12px', borderRadius: '12px', background: accent === 'en-US' ? '#1a2a6c' : 'transparent', color: accent === 'en-US' ? 'white' : '#64748b', fontWeight: '800', border: 'none', cursor: isProcessing ? 'not-allowed' : 'pointer', boxShadow: accent === 'en-US' ? '0 4px 12px rgba(26, 42, 108, 0.3)' : 'none', transition: 'all 0.3s ease', fontSize: '0.95rem' }}>🇺🇸 USA</button>
          <button onClick={() => setAccent('en-GB')} disabled={isProcessing} style={{ flex: 1, padding: '12px', borderRadius: '12px', background: accent === 'en-GB' ? '#1a2a6c' : 'transparent', color: accent === 'en-GB' ? 'white' : '#64748b', fontWeight: '800', border: 'none', cursor: isProcessing ? 'not-allowed' : 'pointer', boxShadow: accent === 'en-GB' ? '0 4px 12px rgba(26, 42, 108, 0.3)' : 'none', transition: 'all 0.3s ease', fontSize: '0.95rem' }}>🇬🇧 UK</button>
        </div>

        <button 
          onClick={handleMainAction} 
          disabled={isProcessing || (!isRecording && !text.trim() && !isCompleted)}
          style={{ 
            width: '100%', padding: '18px', borderRadius: '16px', border: 'none', 
            background: isProcessing ? '#f59e0b' : isRecording ? '#ef4444' : isCompleted ? '#ff6a00' : '#1a2a6c', 
            color: 'white', fontWeight: '800', fontSize: '1rem', 
            cursor: (isProcessing || (!isRecording && !text.trim() && !isCompleted)) ? 'not-allowed' : 'pointer',
            transition: 'background 0.3s',
            boxShadow: isProcessing ? 'none' : '0 10px 15px -3px rgba(0,0,0,0.1)'
          }}
        >
          {isProcessing ? '⏳ Analisando, não vai demorar...' : isRecording ? '🔴 CLIQUE PARA PARAR' : isCompleted ? '🌟 PERFEITO! NOVA FRASE 🎲' : '🎤 PRATICAR PRONÚNCIA'}
        </button>

        {feedback && !isProcessing && (
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
