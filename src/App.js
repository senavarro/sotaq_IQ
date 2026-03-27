import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import confetti from 'canvas-confetti';
import { curatedPhrases } from './phraseBank'; 

const MAX_ENERGY = 7;
const MAX_RECORDING_TIME = 5000;

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

  // UI States for User Menu & Pro Modal
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProModal, setShowProModal] = useState(false);

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
    if (stats.count <= 0) {
      setShowProModal(true);
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
        
        // The Strict Math is preserved
        let strictScore = Math.round((rawAverage * 0.3) + (lowestPhonemeScore * 0.5) + (fluency * 0.2));
        const strictErrors = wordData.filter(w => (Number(w.accuracy) || 100) < 90).map(w => ({ ...w, worstPhoneme: w.phonemes?.reduce((prev, curr) => (Number(prev.score) < Number(curr.score)) ? prev : curr) }));
        if (strictErrors.length > 0) strictScore -= (strictErrors.length * 6); 
        if (isNaN(strictScore)) strictScore = 0;
        strictScore = Math.max(0, Math.min(100, strictScore)); 

        // 🇧🇷 THE BRAZILIAN ENCOURAGEMENT BOOST
        // Gives a gentle +6 bump to anyone scoring between 60% and 94% to keep morale high!
        if (strictScore >= 60 && strictScore <= 94) {
            strictScore += 6;
        } else if (strictScore > 94 && strictScore < 100) {
            strictScore = 99;
        }
        strictScore = Math.min(100, strictScore);

        const stars = strictScore >= 85 ? 3 : strictScore >= 65 ? 2 : strictScore >= 35 ? 1 : 0;
        
        setFeedback({ 
            score: strictScore, 
            stars, 
            fluency, 
            prosody: data.prosody || 0, 
            heard: data.heard, 
            errors: strictErrors, 
            msg: strictScore >= 85 ? "Nativo! 🔥" : strictScore >= 65 ? "Bom sotaque! 🌟" : "Forte sotaque detectado! 🐢" 
        });
        
        if (stars === 3) confetti();
        const newXP = stats.xp + (stars * 10);
        const newCount = stats.count - 1; 
        setStats({ count: newCount, xp: newXP });
        await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
      } catch (err) { alert("Erro ao analisar."); } finally { setIsProcessing(false); }
    };
  };

// Reusable Paywall Component with the Comparison Table
  const ProPaywall = () => (
    <div style={{ background: 'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 100%)', padding: '30px', borderRadius: '24px', color: 'white', textAlign: 'center', marginBottom: '20px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)', position: 'relative' }}>
        {/* Close Button for Manual Trigger */}
        {!isOutOfEnergy && (
            <button onClick={() => setShowProModal(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' }}>X</button>
        )}
        <h2 style={{ fontSize: '1.8rem', fontWeight: '900', margin: '0 0 10px 0' }}>{isOutOfEnergy ? "Vidas Esgotadas! ⚡" : "SotaQ PRO ⭐"}</h2>
        <p style={{ fontSize: '0.95rem', opacity: 0.9, marginBottom: '20px' }}>Domine seu sotaque e treine sem limites.</p>
        
        {/* 📊 THE NEW COMPARISON TABLE */}
        <div style={{ background: 'rgba(0, 0, 0, 0.2)', borderRadius: '16px', padding: '15px', marginBottom: '20px', textAlign: 'left', fontSize: '0.85rem', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '10px', marginBottom: '12px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <div style={{ flex: 1, color: '#cbd5e1' }}>SotaQ Free</div>
                <div style={{ flex: 1, color: '#fbbf24' }}>SotaQ PRO ⭐</div>
            </div>
            
            <div style={{ display: 'flex', marginBottom: '12px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, paddingRight: '10px', color: '#94a3b8' }}>❌ 7 vidas por dia</div>
                <div style={{ flex: 1, color: 'white', fontWeight: 'bold' }}>✅ Vidas Infinitas ⚡</div>
            </div>
            
            <div style={{ display: 'flex', marginBottom: '12px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, paddingRight: '10px', color: '#94a3b8' }}>❌ Apenas frases prontas</div>
                <div style={{ flex: 1, color: 'white', fontWeight: 'bold' }}>✅ Criar próprias frases + Refazer erros (&lt;75%) ✍️</div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, paddingRight: '10px', color: '#94a3b8' }}>❌ Nota de Precisão</div>
                <div style={{ flex: 1, color: 'white', fontWeight: 'bold' }}>✅ Precisão + Ritmo + Fluência 📊</div>
            </div>
        </div>

        {/* PRICING & CTA */}
        <div style={{ background: 'rgba(255,255,255,0.1)', padding: '15px', borderRadius: '16px', marginBottom: '20px' }}>
            <p style={{ margin: '0', fontSize: '0.9rem', textDecoration: 'line-through', opacity: 0.6 }}>R$ 239,88 / ano</p>
            <p style={{ margin: '5px 0', fontSize: '1.5rem', fontWeight: '900', color: '#fbbf24' }}>R$ 199,00 <span style={{fontSize: '0.8rem', color: 'white', fontWeight: 'normal'}}>Anual</span></p>
            <p style={{ margin: '0', fontSize: '0.95rem', fontWeight: '700' }}>ou apenas R$ 19,99 <span style={{fontSize: '0.75rem', fontWeight: 'normal'}}>Mensal</span></p>
        </div>
        
        <a href="https://wa.me/553198011835?text=Olá!%20Quero%20fazer%20o%20upgrade%20para%20o%20SotaQ%20PRO" target="_blank" rel="noreferrer" style={{ display: 'block', background: '#25D366', color: 'white', padding: '16px', borderRadius: '14px', textDecoration: 'none', fontWeight: '900', fontSize: '1.1rem', boxShadow: '0 10px 15px rgba(0,0,0,0.2)', transition: '0.2s' }}>
            QUERO SER PRO 🚀
        </a>
        <p style={{ marginTop: '12px', marginBottom: 0, fontSize: '0.75rem', opacity: 0.7 }}>Ativação imediata via suporte no WhatsApp</p>
    </div>
  );

  if (!user) {
    return (
      <div style={{ background: '#f0f4f8', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '20px' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h1 style={{ color: '#1a2a6c', fontWeight: '900', fontSize: '2.2rem', margin: '0 0 5px 0' }}>SotaQ AI</h1>
            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Login</p>
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

  // Preserve the Avançar Button Logic
  let actionButtonProps = { text: '🎤 PRATICAR', bg: '#1a2a6c', onClick: startRecording, disabled: !text || text.trim().length === 0 };
  if (isProcessing) {
    actionButtonProps = { text: '⏳ AVALIANDO...', bg: '#f59e0b', onClick: null, disabled: true };
  } else if (isRecording) {
    actionButtonProps = { text: '🛑 PARAR (MÁX 5s)', bg: '#ef4444', onClick: stopRecording, disabled: false };
  } else if (feedback && feedback.score >= 85) {
    actionButtonProps = { text: isCustomMode ? '✨ TENTAR DE NOVO' : '⏩ AVANÇAR', bg: '#10b981', onClick: isCustomMode ? () => setFeedback(null) : loadRandomPhrase, disabled: false };
  }

  return (
    <div style={{ background: '#f0f4f8', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      

      {showRules && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '24px', maxWidth: '400px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', animation: 'fadeIn 0.3s' }}>
            
            <div style={{ textAlign: 'center', marginBottom: '25px' }}>
                <h3 style={{ marginTop: 0, color: '#1a2a6c', fontWeight: '900', fontSize: '1.5rem', marginBottom: '5px' }}>📖 Como Funciona?</h3>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>Domine seu sotaque com a IA mais rigorosa do mercado.</p>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '30px' }}>
              
              {/* Regra 1: Energia */}
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#fef3c7', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⚡</div>
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Energia Diária</strong>
                  <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Você tem <strong>7 vidas gratuitas</strong> por dia. Cada tentativa de gravação consome 1 vida.</span>
                </div>
              </div>


              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#e0e7ff', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✍️</div>
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Modos de Treino</strong>
                  <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Gere frases <strong>Aleatórias</strong> ou clique em <strong>Digitar</strong> para simular apresentações e entrevistas reais.</span>
                </div>
              </div>


              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#dcfce7', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔊</div>
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Calibre seu Ouvido</strong>
                  <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Use o botão <strong>Ouvir</strong> para escutar a pronúncia e o ritmo nativo antes de gastar sua energia.</span>
                </div>
              </div>


              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#fee2e2', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎯</div>
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Raio-X Implacável</strong>
                  <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Nossa IA avalia sílabas microscópicas. Se você substituir um "Th" por "F", ela vai apontar o erro!</span>
                </div>
              </div>

            </div>

            <button 
              onClick={() => setShowRules(false)} 
              style={{ width: '100%', padding: '16px', background: '#1a2a6c', color: 'white', border: 'none', borderRadius: '16px', fontWeight: '900', fontSize: '1.05rem', cursor: 'pointer', boxShadow: '0 10px 15px -3px rgba(26, 42, 108, 0.3)', transition: '0.2s' }}
            >
              ENTENDI, VAMOS LÁ! 🚀
            </button>
          </div>
        </div>
      )}
      {/* HEADER WITH UNIFIED DROPDOWN */}
      <nav style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '450px', margin: '0 auto' }}>
        <div onClick={() => setShowUserMenu(!showUserMenu)} style={{ cursor: 'pointer', position: 'relative' }}>
            <h1 style={{ fontSize: '1.2rem', fontWeight: '900', color: '#1a2a6c', margin: 0 }}>SotaQ <span style={{fontSize: '0.7rem', color: '#ff6a00', verticalAlign: 'middle'}}>FREE</span> ▼</h1>
            
            {showUserMenu && (
                <div style={{ position: 'absolute', top: '30px', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', boxShadow: '0 10px 15px rgba(0,0,0,0.1)', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button onClick={() => { setShowProModal(true); setShowUserMenu(false); }} style={{ background: '#ff6a00', color: 'white', border: 'none', borderRadius: '8px', padding: '10px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center' }}>⭐ Upgrade PRO</button>
                    <button onClick={handleLogout} style={{ background: '#fef2f2', border: 'none', color: '#ef4444', borderRadius: '8px', padding: '10px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center' }}>Sair da Conta 🚪</button>
                </div>
            )}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => setShowRules(true)} style={{ background: 'transparent', border: 'none', fontSize: '0.8rem', fontWeight: '800', color: '#64748b', cursor: 'pointer' }}>Regras</button>
          <div style={{ background: 'white', padding: '8px 16px', borderRadius: '50px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontWeight: '800', color: '#1a2a6c' }}>
            ⚡ {stats.count}/{MAX_ENERGY}
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: '450px', margin: '0 auto', padding: '0 20px', paddingBottom: '40px' }}>
        <div style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: '800', color: '#64748b', marginBottom: '5px' }}>
            <span>NÍVEL {level.level}</span>
            <span>{stats.xp} XP</span>
          </div>
          <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ width: `${level.progress}%`, height: '100%', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)' }} />
          </div>
        </div>


        {(isOutOfEnergy || showProModal) && <ProPaywall />}

        {(!isOutOfEnergy && !showProModal) && (
          <>
            <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '16px', padding: '4px', marginBottom: '20px' }}>
              <button onClick={() => setAccent('en-US')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-US' ? '#1a2a6c' : 'transparent', color: accent === 'en-US' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}>🇺🇸 Americano</button>
              <button onClick={() => setAccent('en-GB')} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: accent === 'en-GB' ? '#1a2a6c' : 'transparent', color: accent === 'en-GB' ? 'white' : '#64748b', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}>🇬🇧 Britânico</button>
            </div>

            <div style={{ background: 'white', borderRadius: '30px', padding: '30px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)', textAlign: 'center', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    <button onClick={loadRandomPhrase} style={{ background: !isCustomMode ? '#ff6a00' : '#f1f5f9', color: !isCustomMode ? 'white' : '#64748b', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer', transition: '0.2s' }}>🎲 ALEATÓRIA</button>
                    <button onClick={enableCustomMode} style={{ background: isCustomMode ? '#ff6a00' : '#f1f5f9', color: isCustomMode ? 'white' : '#64748b', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer', transition: '0.2s' }}>✍️ DIGITAR</button>
                    <button onClick={playAudio} disabled={!text || text.trim() === ''} style={{ background: '#1a2a6c', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer', opacity: text ? 1 : 0.5 }}>🔊 OUVIR</button>
                </div>
                {isCustomMode ? <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite em inglês..." maxLength={100} style={{ width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: '16px', border: '2px dashed #cbd5e1', fontSize: '1.2rem', fontWeight: 'bold', textAlign: 'center', minHeight: '100px', outline: 'none', resize: 'none' }} /> : 
                <><h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: '0 0 10px 0' }}>{text || "Escolha uma frase..."}</h2>{translation && <p style={{ color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>🇧🇷 "{translation}"</p>}</>}
            </div>

            {feedback && !isProcessing && (
              <div style={{ background: 'white', padding: '20px', borderRadius: '24px', textAlign: 'center', marginBottom: '20px', border: '2px solid #e2e8f0', animation: 'fadeIn 0.5s' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '5px', color: '#f59e0b' }}>{'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}</div>
                <p style={{ fontWeight: '900', color: '#1a2a6c', margin: '0 0 5px 0', fontSize: '1.4rem' }}>{feedback.score}% Precisão</p>
                <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 15px 0', fontStyle: 'italic' }}>🗣️ IA ouviu: "{feedback.heard}"</p>
                
                <div style={{ display: 'flex', justifyContent: 'space-around', margin: '15px 0', padding: '10px', background: '#f8fafc', borderRadius: '12px' }}>
                    <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Ritmo Bruto</span><strong style={{ color: '#334155' }}>{feedback.prosody}%</strong></div>
                    <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Fluência</span><strong style={{ color: '#334155' }}>{feedback.fluency}%</strong></div>
                </div>

                {feedback.errors?.length > 0 ? (
                  <div style={{ marginTop: '15px', background: '#fef2f2', padding: '10px', borderRadius: '12px', border: '1px solid #fca5a5' }}>
                    <p style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ef4444', margin: '0 0 10px 0' }}>⚠️ Raio-X:</p>
                    {feedback.errors.map((err, i) => (
                      <div key={i} style={{ background: '#ef4444', color: 'white', padding: '8px 12px', borderRadius: '8px', textAlign: 'left', marginBottom: '8px' }}>
                        <span style={{ display: 'block', fontSize: '1rem', fontWeight: 'bold' }}>{err.word}</span>
                        {err.worstPhoneme && (
                            <p style={{ fontSize: '0.75rem', margin: '5px 0 0 0', background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '6px' }}>
                                💡 {getPhonemeTip(err.worstPhoneme.sound)}
                            </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : feedback.score > 0 ? (
                    <p style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#10b981', margin: '10px 0 0 0' }}>Nenhum erro detectado! 🎯</p>
                ) : null}

                <p style={{ fontWeight: '800', margin: '15px 0 0 0', color: feedback.score >= 85 ? '#10b981' : '#ef4444' }}>{feedback.msg}</p>

                {feedback.score > 0 && (
                  <button onClick={handleShare} style={{ marginTop: '20px', width: '100%', background: '#25D366', color: 'white', padding: '12px', borderRadius: '12px', border: 'none', fontWeight: '900', fontSize: '1rem', cursor: 'pointer', boxShadow: '0 4px 10px rgba(37, 211, 102, 0.3)', transition: '0.2s' }}>
                    📲 DESAFIAR AMIGOS
                  </button>
                )}
              </div>
            )}

            <button onClick={actionButtonProps.onClick} disabled={actionButtonProps.disabled} style={{ width: '100%', padding: '24px', borderRadius: '24px', border: 'none', background: actionButtonProps.bg, color: 'white', fontWeight: '900', fontSize: '1.1rem', cursor: actionButtonProps.disabled ? 'not-allowed' : 'pointer', boxShadow: actionButtonProps.bg === '#ef4444' ? '0 0 15px rgba(239, 68, 68, 0.5)' : '0 10px 15px -3px rgba(0,0,0,0.1)', transition: 'all 0.3s', opacity: actionButtonProps.disabled ? 0.7 : 1 }}>
              {actionButtonProps.text}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
