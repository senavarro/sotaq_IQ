import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import confetti from 'canvas-confetti';
import { curatedPhrases } from './phraseBank'; 

const MAX_ENERGY = 7;
const MAX_RECORDING_TIME = 5000;

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

const convertToWav = async (blob) => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  let pos = 0, offset = 0, sample;

  const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); 
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(16000); setUint32(16000 * 2 * numOfChan); setUint16(numOfChan * 2);
  setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

  const channels = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) channels.push(audioBuffer.getChannelData(i));
  
  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

export default function SotaQApp() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [stats, setStats] = useState({ count: MAX_ENERGY, xp: 0 });
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  const [accent, setAccent] = useState('en-US');
  
  const [showRules, setShowRules] = useState(false);
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
    setIsLoggingIn(true);
    try {
      let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
      if (uStats) {
        const today = new Date().toISOString().split('T')[0];
        if (uStats.last_played_date !== today) {
          const { data: updated } = await supabase.from('user_stats')
            .update({ daily_count: MAX_ENERGY, last_played_date: today })
            .eq('email', mail).select().single();
          uStats = updated;
        }
        setStats({ count: Math.min(uStats.daily_count, MAX_ENERGY), xp: uStats.total_xp });
        setUser(mail);
        localStorage.setItem('quevedo_vip_user', mail);
      } else {
        alert("Usuário não encontrado. Verifique seu email.");
      }
    } catch (err) {
      alert("Erro na conexão com o banco de dados.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loadRandomPhrase = () => {
    setFeedback(null);
    const item = curatedPhrases[Math.floor(Math.random() * curatedPhrases.length)];
    setText(typeof item === 'object' ? item.en : item);
    setTranslation(typeof item === 'object' ? item.pt : '');
  };

  const playAudio = () => {
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = accent; 
    utterance.rate = 0.85; 
    
    const voices = window.speechSynthesis.getVoices();
    const targetVoice = voices.find(v => v.lang.replace('_', '-') === accent);
    if (targetVoice) utterance.voice = targetVoice;
    
    window.speechSynthesis.speak(utterance);
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
        const webmBlob = new Blob(chunks, { type: 'audio/webm' });
        const wavBlob = await convertToWav(webmBlob); 
        await analyzeSpeech(wavBlob);
        stream.getTracks().forEach(track => track.stop()); 
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);

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

  // 🚨 THE MISSING FUNCTION IS BACK! 🚨
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
          body: JSON.stringify({ audio: base64Audio, referenceText: text, locale: accent })
        });

        if (!response.ok) throw new Error("Erro na API");
        const data = await response.json();
        
        let rawScore = data.score || 0;
        let prosody = data.prosody || 0;
        let errors = data.mispronunciations || [];

        // 🚨 RUTHLESS ACCENT MATH 🚨
        let strictScore = Math.round((rawScore * 0.7) + (prosody * 0.3));
        if (errors.length > 0) {
            strictScore -= (errors.length * 5); 
        }
        strictScore = Math.max(0, Math.min(100, strictScore)); 
        
        const stars = strictScore >= 85 ? 3 : strictScore >= 65 ? 2 : strictScore >= 35 ? 1 : 0;
        
        setFeedback({
          score: strictScore,
          stars: stars,
          fluency: data.fluency || 0,
          prosody: prosody,
          heard: data.heard || "Não entendi nada.",
          errors: errors,
          msg: strictScore >= 85 ? "Nativo! 🔥" : strictScore >= 65 ? "Bom sotaque! 🌟" : "Forte sotaque detectado! 🐢"
        });

        if (stars === 3) confetti();
        
        const newXP = stats.xp + (stars * 10);
        const newCount = stats.count - 1; // Deduct energy
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
      <div style={{ background: '#f0f4f8', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '20px' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h1 style={{ color: '#1a2a6c', fontWeight: '900', fontSize: '2.2rem', margin: '0 0 5px 0' }}>SotaQ AI</h1>
            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Acesse sua conta para treinar.</p>
          </div>
          <input 
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} 
            placeholder="Seu email cadastrado..." 
            style={{ width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', marginBottom: '15px', outline: 'none' }}
          />
          <button 
            onClick={() => restoreSession(email)} 
            disabled={isLoggingIn || !email}
            style={{ width: '100%', background: isLoggingIn ? '#cbd5e1' : '#ff6a00', color: 'white', padding: '15px', borderRadius: '12px', border: 'none', fontWeight: '800', fontSize: '1.1rem', cursor: isLoggingIn ? 'not-allowed' : 'pointer', transition: '0.3s' }}>
            {isLoggingIn ? 'ENTRANDO...' : 'ENTRAR'}
          </button>
        </div>
      </div>
    );
  }

  const level = getLevelInfo(stats.xp);

  let actionButtonProps = { text: '🎤 PRATICAR', bg: '#1a2a6c', onClick: startRecording, disabled: !text };
  if (isProcessing) {
    actionButtonProps = { text: '⏳ AVALIANDO...', bg: '#f59e0b', onClick: null, disabled: true };
  } else if (isRecording) {
    actionButtonProps = { text: '🛑 PARAR (MÁX 5s)', bg: '#ef4444', onClick: stopRecording, disabled: false };
  } else if (feedback && feedback.score >= 85) {
    actionButtonProps = { text: '⏩ AVANÇAR', bg: '#10b981', onClick: loadRandomPhrase, disabled: false };
  }

  return (
    <div style={{ background: '#f0f4f8', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      
      {/* 📜 RULES MODAL */}
      {showRules && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '24px', maxWidth: '400px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <h3 style={{ marginTop: 0, color: '#1a2a6c', fontWeight: '900', fontSize: '1.4rem' }}>📖 Como Funciona</h3>
            <ul style={{ paddingLeft: '20px', color: '#475569', fontSize: '0.9rem', lineHeight: '1.6', margin: '20px 0' }}>
              <li style={{ marginBottom: '10px' }}><strong>⚡ Energia:</strong> Cada gravação que você faz consome 1 vida, acertando ou errando. Suas 7 vidas recarregam todo dia!</li>
              <li style={{ marginBottom: '10px' }}><strong>🔊 Ouvir:</strong> Aperte este botão para escutar a pronúncia nativa e calibrar seu ouvido antes de gastar sua energia.</li>
              <li style={{ marginBottom: '10px' }}><strong>🌎 Sotaques:</strong> Escolha entre Americano e Britânico. A IA ajusta a régua e te pune se você usar o sotaque da região errada.</li>
              <li><strong>🎯 A Nota:</strong> Nossa IA avalia a exatidão das suas sílabas e o seu ritmo (swing). Gaguejar não baixa seu sotaque, mas soa menos natural!</li>
            </ul>
            <button onClick={() => setShowRules(false)} style={{ width: '100%', padding: '15px', background: '#ff6a00', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '800', fontSize: '1rem', cursor: 'pointer' }}>
              ENTENDI, VAMOS LÁ!
            </button>
          </div>
        </div>
      )}

      <nav style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '450px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: '900', color: '#1a2a6c', margin: 0 }}>SotaQ AI</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <button onClick={() => setShowRules(true)} style={{ background: 'transparent', border: 'none', fontSize: '0.9rem', fontWeight: '800', color: '#64748b', cursor: 'pointer', textDecoration: 'underline' }}>Regras</button>
          <div style={{ background: 'white', padding: '8px 16px', borderRadius: '50px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontWeight: '800', color: '#1a2a6c' }}>
            ⚡ {stats.count}/{MAX_ENERGY}
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: '450px', margin: '0 auto', padding: '0 20px', paddingBottom: '40px' }}>
        
        <div style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '800', marginBottom: '6px', color: '#64748b' }}>
            <span>NÍVEL {level.level}</span>
            <span>{stats.xp} XP</span>
          </div>
          <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ width: `${level.progress}%`, height: '100%', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)', transition: 'width 0.5s' }} />
          </div>
        </div>

        <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '16px', padding: '4px', marginBottom: '20px' }}>
          <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-US' ? '#1a2a6c' : 'transparent', color: accent === 'en-US' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}>🇺🇸 Americano</button>
          <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-GB' ? '#1a2a6c' : 'transparent', color: accent === 'en-GB' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}>🇬🇧 Britânico</button>
        </div>

        <div style={{ background: 'white', borderRadius: '30px', padding: '30px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)', textAlign: 'center', marginBottom: '20px' }}>
           <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '20px' }}>
             <button onClick={loadRandomPhrase} style={{ background: '#ff6a00', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer' }}>🎲 NOVA FRASE</button>
             <button onClick={playAudio} disabled={!text} style={{ background: '#1a2a6c', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer', opacity: text ? 1 : 0.5 }}>🔊 OUVIR</button>
           </div>
           
           <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: '0 0 10px 0' }}>{text || "Pressione 'Nova Frase'..."}</h2>
           {translation && <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>🇧🇷 "{translation}"</p>}
        </div>

        {feedback && !isProcessing && (
          <div style={{ background: 'white', padding: '20px', borderRadius: '24px', textAlign: 'center', marginBottom: '20px', border: '2px solid #e2e8f0', animation: 'fadeIn 0.5s' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '5px', color: '#f59e0b' }}>{'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}</div>
            
            <p style={{ fontWeight: '900', margin: '0 0 5px 0', color: '#1a2a6c', fontSize: '1.4rem' }}>{feedback.score}% Precisão (Sotaque)</p>
            
            <p style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic', margin: '0 0 15px 0' }}>
              🗣️ A IA ouviu: "{feedback.heard}"
            </p>
            
            <div style={{ display: 'flex', justifyContent: 'space-around', margin: '15px 0', padding: '10px', background: '#f8fafc', borderRadius: '12px' }}>
                <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Ritmo Bruto</span><strong style={{ color: '#334155' }}>{feedback.prosody}%</strong></div>
                <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Fluência</span><strong style={{ color: '#334155' }}>{feedback.fluency}%</strong></div>
            </div>

            {feedback.errors && feedback.errors.length > 0 ? (
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

        <button 
          onClick={actionButtonProps.onClick}
          disabled={actionButtonProps.disabled}
          style={{ 
            width: '100%', padding: '24px', borderRadius: '24px', border: 'none',
            background: actionButtonProps.bg,
            color: 'white', fontWeight: '900', fontSize: '1.1rem', cursor: actionButtonProps.disabled ? 'not-allowed' : 'pointer',
            boxShadow: actionButtonProps.bg === '#ef4444' ? '0 0 15px rgba(239, 68, 68, 0.5)' : '0 10px 15px -3px rgba(0,0,0,0.1)',
            transition: 'all 0.3s',
            opacity: actionButtonProps.disabled ? 0.7 : 1
          }}
        >
          {actionButtonProps.text}
        </button>
      </div>
    </div>
  );
}
