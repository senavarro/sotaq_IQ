import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import confetti from 'canvas-confetti';
import { curatedPhrases } from './phraseBank'; 

const MAX_ENERGY = 7;
const MAX_RECORDING_TIME = 5000;

// NEW: The Phonetic Teacher Dictionary
const getPhonemeTip = (phoneme) => {
  const tips = {
    'θ': "Língua entre os dentes soprando o ar (não é som de 'f' nem 's').",
    'ð': "Língua entre os dentes vibrando (não é som de 'd' nem 'z').",
    'ɹ': "Enrole a língua para trás, tipo sotaque caipira (não raspe a garganta).",
    'ɪ': "Som de 'i' bem curto e relaxado, quase puxando pro 'ê'.",
    'i:': "Som de 'i' bem longo e esticado, como um sorriso.",
    'æ': "Abra bem a boca, é um som entre o 'a' e o 'e'.",
    'h': "Solte o ar como um suspiro cansado (o 'h' não é mudo!).",
    'v': "Vibre os dentes no lábio inferior (cuidado para não somar 'b')."
  };
  return tips[phoneme] || "Foque neste som específico.";
};

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
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  const [accent, setAccent] = useState('en-US');
  const [showRules, setShowRules] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordingTimeout, setRecordingTimeout] = useState(null);

  // NEW: State for Logout Dropdown
  const [showUserMenu, setShowUserMenu] = useState(false);

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
        alert("Usuário não encontrado.");
      }
    } catch (err) {
      alert("Erro na conexão.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // NEW: Logout Function
  const handleLogout = () => {
    localStorage.removeItem('quevedo_vip_user');
    setUser(null);
    setStats({ count: MAX_ENERGY, xp: 0 });
    setFeedback(null);
    setShowUserMenu(false);
  };

  const loadRandomPhrase = () => {
    setIsCustomMode(false);
    setFeedback(null);
    const item = curatedPhrases[Math.floor(Math.random() * curatedPhrases.length)];
    setText(typeof item === 'object' ? item.en : item);
    setTranslation(typeof item === 'object' ? item.pt : '');
  };

  const enableCustomMode = () => {
    setIsCustomMode(true);
    setFeedback(null);
    setText('');
    setTranslation('');
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

  const handleShare = async () => {
    const sotaqueNome = accent === 'en-US' ? 'Americano' : 'Britânico';
    const shareText = `Fui julgado pela IA do SotaQ! 🤖\n\nMeu sotaque ${sotaqueNome} atingiu ${feedback.score}% de Precisão.\n\nTente bater meu recorde:`;
    const appUrl = window.location.origin; 
    if (navigator.share) {
      try { await navigator.share({ title: 'SotaQ AI', text: shareText, url: appUrl }); } 
      catch (err) { console.log(err); }
    } else {
      navigator.clipboard.writeText(`${shareText} ${appUrl}`);
      alert("Texto copiado! 🚀");
    }
  };

  const startRecording = async () => {
    if (stats.count <= 0) return; // Energy check
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
        if (recorder.state === "recording") { recorder.stop(); setIsRecording(false); }
      }, MAX_RECORDING_TIME);
      setRecordingTimeout(timeoutId);
    } catch (err) { alert("Permita o acesso ao microfone."); }
  };

  const stopRecording = () => {
    if (recordingTimeout) clearTimeout(recordingTimeout);
    if (mediaRecorder && mediaRecorder.state === "recording") { mediaRecorder.stop(); }
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
        const rawAverage = Number(data.score) || 0;
        const fluency = Number(data.fluency) || 0;
        const wordData = Array.isArray(data.words) ? data.words : [];
        if (wordData.length === 0 || !data.heard) {
            setFeedback({ score: 0, heard: "Nenhuma voz detectada.", msg: "Não ouvimos você! 🛑" });
            const newCount = stats.count - 1; setStats({ ...stats, count: newCount });
            await supabase.from('user_stats').update({ daily_count: newCount }).eq('email', user);
            setIsProcessing(false); return;
        }
        let allPhonemes = [];
        wordData.forEach(w => w.phonemes?.forEach(p => allPhonemes.push({ word: w.word, sound: p.sound, score: Number(p.score) || 100 })));
        let lowestPhonemeScore = allPhonemes.length > 0 ? Math.min(...allPhonemes.map(p => p.score)) : rawAverage;
        let strictScore = Math.round((rawAverage * 0.3) + (lowestPhonemeScore * 0.5) + (fluency * 0.2));
        const strictErrors = wordData.filter(w => (Number(w.accuracy) || 100) < 90).map(w => ({ ...w, worstPhoneme: w.phonemes?.reduce((prev, curr) => (Number(prev.score) < Number(curr.score)) ? prev : curr) }));
        if (strictErrors.length > 0) strictScore -= (strictErrors.length * 6); 
        strictScore = Math.max(0, Math.min(100, strictScore)); 
        const stars = strictScore >= 85 ? 3 : strictScore >= 65 ? 2 : strictScore >= 35 ? 1 : 0;
        setFeedback({ score: strictScore, stars, fluency, prosody: data.prosody || 0, heard: data.heard, errors: strictErrors, msg: strictScore >= 85 ? "Nativo! 🔥" : strictScore >= 65 ? "Bom sotaque! 🌟" : "Forte sotaque detectado! 🐢" });
        if (stars === 3) confetti();
        const newXP = stats.xp + (stars * 10);
        const newCount = stats.count - 1; 
        setStats({ count: newCount, xp: newXP });
        await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
      } catch (err) { alert("Erro ao analisar."); } finally { setIsProcessing(false); }
    };
  };

  if (!user) {
    return (
      <div style={{ background: '#f0f4f8', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '20px' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h1 style={{ color: '#1a2a6c', fontWeight: '900', fontSize: '2.2rem', margin: '0 0 5px 0' }}>SotaQ AI</h1>
            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Login (Versão Gratuita)</p>
          </div>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Seu email..." style={{ width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', marginBottom: '15px', outline: 'none' }} />
          <button onClick={() => restoreSession(email)} disabled={isLoggingIn || !email} style={{ width: '100%', background: isLoggingIn ? '#cbd5e1' : '#ff6a00', color: 'white', padding: '15px', borderRadius: '12px', border: 'none', fontWeight: '800', fontSize: '1.1rem', cursor: 'pointer' }}>
            {isLoggingIn ? 'ENTRANDO...' : 'ENTRAR'}
          </button>
        </div>
      </div>
    );
  }

  const level = getLevelInfo(stats.xp);
  const isOutOfEnergy = stats.count <= 0;

  return (
    <div style={{ background: '#f0f4f8', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      
    {showRules && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'white', padding: '30px', borderRadius: '24px', maxWidth: '400px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
          <h3 style={{ marginTop: 0, color: '#1a2a6c', fontWeight: '900', fontSize: '1.4rem' }}>📖 Como funciona o SotaQ?</h3>
          
          <ul style={{ paddingLeft: '20px', color: '#475569', fontSize: '0.9rem', lineHeight: '1.6', margin: '20px 0' }}>
            <li style={{ marginBottom: '10px' }}>
              ⚡ <strong>7 Vidas:</strong> Você tem 7 tentativas por dia. <strong>Cada gravação consome 1 vida</strong>, independente do resultado. Suas vidas resetam à meia-noite!
            </li>
            <li style={{ marginBottom: '10px' }}>
              ⏱️ <strong>Limite de 5s:</strong> Focamos em frases curtas e diretas. Se a gravação passar de 5 segundos, ela será cortada automaticamente.
            </li>
            <li style={{ marginBottom: '10px' }}>
              🌎 <strong>Americano vs Britânico:</strong> A régua da IA muda completamente dependendo do sotaque escolhido. Escolha um e tente ser fiel aos fonemas da região!
            </li>
            <li style={{ marginBottom: '10px' }}>
              🎯 <strong>Feedback de Raio-X:</strong> Nossa IA não avalia apenas se você "falou certo", mas sim a precisão das suas sílabas, seu ritmo e sua fluência.
            </li>
            <li>
              🔊 <strong>Ouvir:</strong> Use o botão de áudio para calibrar seu ouvido antes de gastar sua energia gravando.
            </li>
          </ul>
    
          <button 
            onClick={() => setShowRules(false)} 
            style={{ width: '100%', padding: '15px', background: '#ff6a00', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '800', fontSize: '1rem', cursor: 'pointer' }}
          >
            ENTENDI, VAMOS LÁ!
          </button>
        </div>
      </div>
    )}

      {/* HEADER WITH LOGOUT */}
      <nav style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '450px', margin: '0 auto' }}>
        <div onClick={() => setShowUserMenu(!showUserMenu)} style={{ cursor: 'pointer', position: 'relative' }}>
            <h1 style={{ fontSize: '1.2rem', fontWeight: '900', color: '#1a2a6c', margin: 0 }}>SotaQ <span style={{fontSize: '0.7rem', color: '#ff6a00', verticalAlign: 'middle'}}>FREE</span> ▼</h1>
            {showUserMenu && (
                <div style={{ position: 'absolute', top: '30px', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', boxShadow: '0 10px 15px rgba(0,0,0,0.1)', zIndex: 1000 }}>
                    <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>Sair da Conta 🚪</button>
                </div>
            )}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => setShowRules(true)} style={{ background: 'transparent', border: 'none', fontSize: '0.8rem', fontWeight: '800', color: '#64748b' }}>Regras</button>
          <div style={{ background: 'white', padding: '8px 16px', borderRadius: '50px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontWeight: '800', color: '#1a2a6c' }}>
            ⚡ {stats.count}/{MAX_ENERGY}
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: '450px', margin: '0 auto', padding: '0 20px' }}>
        <div style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '800', color: '#64748b', marginBottom: '5px' }}>
            <span>NÍVEL {level.level}</span>
            <span>{stats.xp} XP</span>
          </div>
          <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ width: `${level.progress}%`, height: '100%', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)' }} />
          </div>
        </div>

        {/* PRO PAYWALL MODAL */}
        {isOutOfEnergy && (
            <div style={{ background: 'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 100%)', padding: '30px', borderRadius: '24px', color: 'white', textAlign: 'center', marginBottom: '20px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
                <h2 style={{ fontSize: '1.8rem', fontWeight: '900', margin: '0 0 10px 0' }}>Vidas Esgotadas! ⚡</h2>
                <p style={{ fontSize: '1rem', opacity: 0.9, marginBottom: '20px' }}>Quer treinar sem limites e dominar seu sotaque hoje mesmo?</p>
                <div style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '16px', marginBottom: '25px' }}>
                    <p style={{ margin: '0', fontSize: '0.9rem', textDecoration: 'line-through', opacity: 0.6 }}>R$ 239,88 / ano</p>
                    <p style={{ margin: '5px 0', fontSize: '1.4rem', fontWeight: '900' }}>R$ 199,00 <span style={{fontSize: '0.8rem'}}>Anual</span></p>
                    <p style={{ margin: '0', fontSize: '1rem', fontWeight: '700' }}>ou R$ 19,99 <span style={{fontSize: '0.8rem'}}>Mensal</span></p>
                </div>
                <a href="https://wa.me/553198011835?text=Olá!%20Quero%20fazer%20o%20upgrade%20para%20o%20SotaQ%20PRO" target="_blank" rel="noreferrer" style={{ display: 'block', background: '#25D366', color: 'white', padding: '18px', borderRadius: '14px', textDecoration: 'none', fontWeight: '900', fontSize: '1.1rem', boxShadow: '0 10px 15px rgba(0,0,0,0.2)' }}>
                    QUERO ENERGIA INFINITA 🚀
                </a>
                <p style={{ marginTop: '15px', fontSize: '0.75rem', opacity: 0.7 }}>Ativação imediata via WhatsApp</p>
            </div>
        )}

        {!isOutOfEnergy && (
          <>
            <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '16px', padding: '4px', marginBottom: '20px' }}>
              <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-US' ? '#1a2a6c' : 'transparent', color: accent === 'en-US' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer' }}>🇺🇸 Americano</button>
              <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-GB' ? '#1a2a6c' : 'transparent', color: accent === 'en-GB' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer' }}>🇬🇧 Britânico</button>
            </div>

            <div style={{ background: 'white', borderRadius: '30px', padding: '30px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)', textAlign: 'center', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
                    <button onClick={loadRandomPhrase} style={{ background: !isCustomMode ? '#ff6a00' : '#f1f5f9', color: !isCustomMode ? 'white' : '#64748b', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer' }}>🎲 ALEATÓRIA</button>
                    <button onClick={enableCustomMode} style={{ background: isCustomMode ? '#ff6a00' : '#f1f5f9', color: isCustomMode ? 'white' : '#64748b', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer' }}>✍️ DIGITAR</button>
                    <button onClick={playAudio} disabled={!text} style={{ background: '#1a2a6c', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer', opacity: text ? 1 : 0.5 }}>🔊 OUVIR</button>
                </div>
                {isCustomMode ? <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite em inglês..." maxLength={100} style={{ width: '100%', padding: '15px', borderRadius: '16px', border: '2px dashed #cbd5e1', fontSize: '1.2rem', fontWeight: 'bold', textAlign: 'center', minHeight: '100px', outline: 'none' }} /> : 
                <><h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a' }}>{text || "Escolha uma frase..."}</h2>{translation && <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>🇧🇷 "{translation}"</p>}</>}
            </div>

            {feedback && !isProcessing && (
              <div style={{ background: 'white', padding: '20px', borderRadius: '24px', textAlign: 'center', marginBottom: '20px', border: '2px solid #e2e8f0' }}>
                <div style={{ fontSize: '1.5rem', color: '#f59e0b' }}>{'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}</div>
                <p style={{ fontWeight: '900', color: '#1a2a6c', fontSize: '1.4rem' }}>{feedback.score}% Precisão</p>
                <p style={{ color: '#64748b', fontSize: '0.8rem', fontStyle: 'italic' }}>🗣️ IA ouviu: "{feedback.heard}"</p>
                
                {feedback.errors?.length > 0 && (
                  <div style={{ marginTop: '15px', background: '#fef2f2', padding: '10px', borderRadius: '12px', border: '1px solid #fca5a5' }}>
                    <p style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ef4444' }}>⚠️ Raio-X:</p>
                    {feedback.errors.map((err, i) => (
                      <div key={i} style={{ background: '#ef4444', color: 'white', padding: '8px', borderRadius: '8px', textAlign: 'left', marginBottom: '5px' }}>
                        <span style={{ fontWeight: 'bold' }}>{err.word}</span>
                        <p style={{ fontSize: '0.7rem', margin: '3px 0 0 0' }}>💡 {getPhonemeTip(err.worstPhoneme?.sound)}</p>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={handleShare} style={{ marginTop: '15px', width: '100%', background: '#25D366', color: 'white', padding: '12px', borderRadius: '12px', border: 'none', fontWeight: '900', cursor: 'pointer' }}>📲 DESAFIAR AMIGOS</button>
              </div>
            )}

            <button onClick={isRecording ? stopRecording : startRecording} disabled={isProcessing || !text} style={{ width: '100%', padding: '24px', borderRadius: '24px', border: 'none', background: isProcessing ? '#f59e0b' : isRecording ? '#ef4444' : '#1a2a6c', color: 'white', fontWeight: '900', fontSize: '1.1rem', cursor: 'pointer', opacity: (!text || isProcessing) ? 0.7 : 1 }}>
              {isProcessing ? '⏳ AVALIANDO...' : isRecording ? '🛑 PARAR (MÁX 5s)' : (feedback && feedback.score >= 85) ? '⏩ AVANÇAR' : '🎤 PRATICAR'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
