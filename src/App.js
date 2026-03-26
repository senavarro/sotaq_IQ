import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import confetti from 'canvas-confetti';
import { curatedPhrases } from './phraseBank'; 

// --- SOTAQ ECONOMY LIMITS ---
const MAX_ENERGY = 7;
const MAX_RECORDING_TIME = 5000; // 5 Seconds

// --- LEVEL & XP MATH ---
const getLevelInfo = (xp) => {
  const thresholds = [0, 500, 1500, 3000, 5000, 8000, 12000, 17000, 23000, 30000];
  let level = 1;
  let currentMin = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) { level = i + 1; currentMin = thresholds[i]; }
  }
  const isMax = level >= thresholds.length;
  const nextTier = isMax ? currentMin : thresholds[level];
  const progress = isMax ? 100 : ((xp - currentMin) / (nextTier - currentMin)) * 100;
  return { level: isMax ? 10 : level, currentMin, nextTier: isMax ? "MAX" : nextTier, progress };
};

export default function SotaQApp() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [stats, setStats] = useState({ count: MAX_ENERGY, xp: 0 });
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  
  // ACCENT SELECTOR (Default US)
  const [accent, setAccent] = useState('en-US');
  
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordingTimeout, setRecordingTimeout] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('quevedo_vip_user');
    if (saved) restoreSession(saved);
  }, []);

  const restoreSession = async (mail) => {
    let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
    if (uStats) {
      const today = new Date().toISOString().split('T')[0];
      if (uStats.last_played_date !== today) {
        const { data: updated } = await supabase.from('user_stats')
          .update({ daily_count: MAX_ENERGY, last_played_date: today })
          .eq('email', mail).select().single();
        uStats = updated;
      }
      setStats({ count: uStats.daily_count, xp: uStats.total_xp });
      setUser(mail);
    }
  };

  const loadRandomPhrase = () => {
    setFeedback(null);
    const item = curatedPhrases[Math.floor(Math.random() * curatedPhrases.length)];
    setText(typeof item === 'object' ? item.en : item);
    setTranslation(typeof item === 'object' ? item.pt : '');
  };

  const startRecording = async () => {
    if (stats.count <= 0) { 
      alert("Energia esgotada por hoje! Volte amanhã."); 
      return; 
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        setIsProcessing(true);
        const audioBlob = new Blob(chunks, { type: 'audio/wav' });
        await analyzeSpeech(audioBlob);
        stream.getTracks().forEach(track => track.stop()); 
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);

      // 5-SECOND HARD STOP
      const timeoutId = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, MAX_RECORDING_TIME);
      setRecordingTimeout(timeoutId);

    } catch (err) { 
      alert("Por favor, permita o acesso ao microfone."); 
    }
  };

  const stopRecording = () => {
    if (recordingTimeout) clearTimeout(recordingTimeout);
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
    setIsRecording(false);
  };

  const analyzeSpeech = async (blob) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const base64Audio = reader.result.split(',')[1];

      try {
        const response = await fetch('/.netlify/functions/analyze', {
          method: 'POST',
          body: JSON.stringify({ 
            audio: base64Audio, 
            referenceText: text, 
            locale: accent 
          })
        });

        if (!response.ok) throw new Error("Erro na API");
        const data = await response.json();
        
        const score = data.score;
        const stars = score >= 85 ? 3 : score >= 65 ? 2 : score >= 35 ? 1 : 0;
        
        setFeedback({
          score: score,
          stars: stars,
          fluency: data.fluency,
          prosody: data.prosody,
          errors: data.mispronunciations || [],
          msg: score >= 85 ? "Nativo! 🔥" : score >= 65 ? "Bom sotaque! 🌟" : "Cuidado com a pronúncia! 🐢"
        });

        if (stars === 3) confetti();
        
        const newXP = stats.xp + (stars * 10);
        const newCount = stats.count - 1;
        setStats({ count: newCount, xp: newXP });
        await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
        
      } catch (err) {
        alert("Erro ao analisar a voz. Tente novamente.");
      } finally {
        setIsProcessing(false);
      }
    };
  };

  if (!user) {
    return (
      <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <h2>SotaQ Login</h2>
        <input 
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} 
          placeholder="Seu email..." style={{ padding: '10px', fontSize: '1rem' }}
        />
        <button onClick={() => restoreSession(email)} style={{ padding: '10px 20px', marginLeft: '10px' }}>Entrar</button>
      </div>
    );
  }

  const level = getLevelInfo(stats.xp);

  return (
    <div style={{ background: '#f0f4f8', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      {/* HEADER */}
      <nav style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: '900', color: '#1a2a6c', margin: 0 }}>SotaQ AI</h1>
        <div style={{ background: 'white', padding: '8px 16px', borderRadius: '50px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontWeight: '800', color: '#1a2a6c' }}>
          ⚡ {stats.count}/{MAX_ENERGY}
        </div>
      </nav>

      <div style={{ maxWidth: '450px', margin: '0 auto', padding: '0 20px', paddingBottom: '40px' }}>
        
        {/* PROGRESS BAR */}
        <div style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '800', marginBottom: '6px', color: '#64748b' }}>
            <span>NÍVEL {level.level}</span>
            <span>{stats.xp} XP</span>
          </div>
          <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ width: `${level.progress}%`, height: '100%', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)', transition: 'width 0.5s' }} />
          </div>
        </div>

        {/* ACCENT TOGGLE */}
        <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '16px', padding: '4px', marginBottom: '20px' }}>
          <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-US' ? '#1a2a6c' : 'transparent', color: accent === 'en-US' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}>🇺🇸 USA Accent</button>
          <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-GB' ? '#1a2a6c' : 'transparent', color: accent === 'en-GB' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}>🇬🇧 UK Accent</button>
        </div>

        {/* AI CARD */}
        <div style={{ background: 'white', borderRadius: '30px', padding: '30px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)', textAlign: 'center', marginBottom: '20px' }}>
           <button onClick={loadRandomPhrase} style={{ background: '#ff6a00', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', marginBottom: '20px', cursor: 'pointer' }}>🎲 NOVA FRASE</button>
           <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: '0 0 10px 0' }}>{text || "Pressione 'Nova Frase'..."}</h2>
           {translation && <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>🇧🇷 "{translation}"</p>}
        </div>

        {/* FEEDBACK & ERRORS */}
        {feedback && !isProcessing && (
          <div style={{ background: 'white', padding: '20px', borderRadius: '24px', textAlign: 'center', marginBottom: '20px', border: '2px solid #e2e8f0', animation: 'fadeIn 0.5s' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '5px', color: '#f59e0b' }}>{'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}</div>
            <p style={{ fontWeight: '900', margin: '0 0 10px 0', color: '#1a2a6c', fontSize: '1.4rem' }}>{feedback.score}% Precisão</p>
            
            {/* The "Pro" Detailed Stats */}
            <div style={{ display: 'flex', justifyContent: 'space-around', margin: '15px 0', padding: '10px', background: '#f8fafc', borderRadius: '12px' }}>
                <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Ritmo</span><strong style={{ color: '#334155' }}>{feedback.prosody}%</strong></div>
                <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Fluência</span><strong style={{ color: '#334155' }}>{feedback.fluency}%</strong></div>
            </div>

            {/* Error Words Highlighter */}
            {feedback.errors.length > 0 ? (
              <div style={{ marginTop: '15px', padding: '10px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fca5a5' }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ef4444', margin: '0 0 5px 0' }}>⚠️ O que você errou:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '5px' }}>
                  {feedback.errors.map((err, idx) => (
                    <span key={idx} style={{ background: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                      {err.word}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
               <p style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#10b981', margin: '10px 0 0 0' }}>Nenhum erro detectado! 🎯</p>
            )}
            
            <p style={{ fontWeight: '800', margin: '15px 0 0 0', color: feedback.score >= 85 ? '#10b981' : '#f59e0b' }}>{feedback.msg}</p>
          </div>
        )}

        {/* RECORD BUTTON */}
        <button 
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing || !text}
          style={{ 
            width: '100%', padding: '24px', borderRadius: '24px', border: 'none',
            background: isProcessing ? '#f59e0b' : isRecording ? '#ef4444' : '#1a2a6c',
            color: 'white', fontWeight: '900', fontSize: '1.1rem', cursor: 'pointer',
            boxShadow: isRecording ? '0 0 15px rgba(239, 68, 68, 0.5)' : '0 10px 15px -3px rgba(0,0,0,0.1)',
            transition: 'all 0.3s',
            opacity: (!text || isProcessing) ? 0.7 : 1
          }}
        >
          {isProcessing ? '⏳ AVALIANDO SOTAQUE...' : isRecording ? '🛑 PARAR (MÁX 5s)' : '🎤 PRATICAR'}
        </button>
      </div>
    </div>
  );
}
