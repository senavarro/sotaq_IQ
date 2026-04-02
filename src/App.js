import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import confetti from 'canvas-confetti';
import { curatedPhrases } from './phraseBank'; 

const MAX_ENERGY = 7;
const MAX_RECORDING_TIME = 5000;

// Helper Functions in Global Scope
const getLocalTodayDate = () => {
  const d = new Date();
  // Forces the format YYYY-MM-DD based on the user's actual phone/computer timezone
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
  
  const channelData = audioBuffer.getChannelData(0);
  let maxAmplitude = 0;
  let startIndex = -1;
  let endIndex = -1;
  const threshold = 0.02;

  for (let i = 0; i < channelData.length; i++) {
    const val = Math.abs(channelData[i]);
    if (val > maxAmplitude) maxAmplitude = val;
    if (val > threshold) {
      if (startIndex === -1) startIndex = i;
      endIndex = i;
    }
  }

  if (maxAmplitude < threshold || startIndex === -1) {
    return null; 
  }

  const padding = 16000 * 0.2; 
  startIndex = Math.max(0, Math.floor(startIndex - padding));
  endIndex = Math.min(channelData.length, Math.floor(endIndex + padding));
  const trimmedLength = endIndex - startIndex;

  const length = trimmedLength * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  let pos = 0;
  
  const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };
  
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); 
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(16000); setUint32(16000 * 2 * numOfChan); setUint16(numOfChan * 2);
  setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
  
  const channels = [];
  for (let i = 0; i < numOfChan; i++) channels.push(audioBuffer.getChannelData(i));
  
  let offset = startIndex;
  while (pos < length && offset < endIndex) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
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
  const [planType, setPlanType] = useState('free');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [stats, setStats] = useState({ count: MAX_ENERGY, xp: 0 });
  
  const [isRegistering, setIsRegistering] = useState(false);
  const [regName, setRegName] = useState('');
  const [regCountryCode, setRegCountryCode] = useState('+55');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');

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

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProModal, setShowProModal] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('quevedo_vip_user');
    if (saved) restoreSession(saved);
  }, []);

  const restoreSession = async (mail) => {
    setIsLoggingIn(true);
    try {
      let { data: authData, error: authErr } = await supabase.from('allowed_users').select('*').eq('email', mail).single();
      
      if (authErr || !authData) {
        alert("Email não encontrado. Por favor, crie uma conta!");
        setIsLoggingIn(false);
        return;
      }

      const cleanPlan = authData.plan_type ? authData.plan_type.replace(/'/g, "").trim().toLowerCase() : 'free';
      setPlanType(cleanPlan);

      let { data: uStats } = await supabase.from('user_stats').select('*').eq('email', mail).single();
      
      const today = getLocalTodayDate();
      
      if (!uStats) {
        const { data: newStats } = await supabase.from('user_stats').insert([{ email: mail, daily_count: MAX_ENERGY, total_xp: 0, last_played_date: today }]).select().single();
        uStats = newStats;
      } else if (uStats.last_played_date !== today) {
        const { data: updated } = await supabase.from('user_stats').update({ daily_count: MAX_ENERGY, last_played_date: today }).eq('email', mail).select().single();
        uStats = updated;
      }

      setStats({ count: Math.min(uStats.daily_count, MAX_ENERGY), xp: uStats.total_xp });
      setUser(mail);
      localStorage.setItem('quevedo_vip_user', mail);
    } catch (err) {
      alert("Erro na conexão com o banco de dados: " + err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!regName || !regPhone || !regEmail) {
      alert("Por favor, preencha todos os campos.");
      return;
    }
    if (!emailRegex.test(regEmail)) {
      alert("Por favor, insira um email válido.");
      return;
    }

    setIsLoggingIn(true);
    try {
      const { data: existingUser } = await supabase.from('allowed_users').select('email').eq('email', regEmail).single();
      if (existingUser) {
        alert("Este email já está cadastrado! Por favor, faça login.");
        setIsLoggingIn(false);
        return;
      }

      const fullPhone = `${regCountryCode} ${regPhone}`;
      const today = getLocalTodayDate();

      const { error: authError } = await supabase.from('allowed_users').insert([{ 
        email: regEmail, 
        name: regName, 
        phone: fullPhone, 
        plan_type: 'free' 
      }]);
      if (authError) throw new Error("Erro de perfil: " + authError.message);

      const { error: statsError } = await supabase.from('user_stats').insert([{ 
        email: regEmail, 
        daily_count: MAX_ENERGY, 
        total_xp: 0, 
        last_played_date: today 
      }]);
      if (statsError) throw new Error("Erro de status: " + statsError.message);

      setPlanType('free');
      setStats({ count: MAX_ENERGY, xp: 0 });
      setUser(regEmail);
      localStorage.setItem('quevedo_vip_user', regEmail);
      
    } catch (err) {
      alert("Erro ao criar a conta: " + err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('quevedo_vip_user');
    setUser(null);
    setPlanType('free');
    setStats({ count: MAX_ENERGY, xp: 0 });
    setFeedback(null);
    setShowUserMenu(false);
    setEmail('');
    setRegEmail('');
    setRegName('');
    setRegPhone('');
    setIsRegistering(false);
  };

  const loadRandomPhrase = () => {
    setIsCustomMode(false);
    setFeedback(null);
    const item = curatedPhrases[Math.floor(Math.random() * curatedPhrases.length)];
    setText(typeof item === 'object' ? item.en : item);
    setTranslation(typeof item === 'object' ? item.pt : '');
  };

  const handleCustomModeClick = () => {
    if (planType !== 'premium' && planType !== 'pro') {
        setShowProModal(true);
        return;
    }
    enableCustomMode();
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
    const isPremium = planType === 'premium' || planType === 'pro';
    
    // 🧟 ZOMBIE TAB FIX: If they are out of energy, double-check the DB before blocking them
    if (!isPremium && stats.count <= 0) {
      try {
        const today = getLocalTodayDate();
        let { data: checkStats } = await supabase.from('user_stats').select('*').eq('email', user).single();
        
        // If the day actually rolled over while the app was asleep, give them their lives!
        if (checkStats && checkStats.last_played_date !== today) {
           const { data: updated } = await supabase.from('user_stats').update({ daily_count: MAX_ENERGY, last_played_date: today }).eq('email', user).select().single();
           setStats({ count: MAX_ENERGY, xp: updated.total_xp });
           // We don't return here, we let them proceed to record!
        } else {
           // It's still the same day. Block them.
           setShowProModal(true);
           return; 
        }
      } catch (err) {
        setShowProModal(true);
        return;
      }
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
        
        if (!wavBlob) {
            setFeedback({ score: 0, heard: "Nenhuma voz detectada.", msg: "Microfone muito baixo! Chegue mais perto. 🛑" });
            setIsProcessing(false);
            stream.getTracks().forEach(track => track.stop()); 
            return; 
        }

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
        
        let fluency = Number(data.fluency) || 0; 
        
        const wordData = Array.isArray(data.words) ? data.words : [];
        const isPremium = planType === 'premium' || planType === 'pro';
        
        if (wordData.length === 0 || !data.heard) {
            setFeedback({ score: 0, heard: "Nenhuma voz detectada.", msg: "Não ouvimos você! 🛑" });
            if (!isPremium) {
                const newCount = stats.count - 1; setStats({ ...stats, count: newCount });
                await supabase.from('user_stats').update({ daily_count: newCount }).eq('email', user);
            }
            setIsProcessing(false); return;
        }

        let allPhonemes = [];
        wordData.forEach(w => w.phonemes?.forEach(p => allPhonemes.push({ word: w.word, sound: p.sound, score: Number(p.score) || 100 })));
        let lowestPhonemeScore = allPhonemes.length > 0 ? Math.min(...allPhonemes.map(p => p.score)) : rawAverage;
        
        if (lowestPhonemeScore < 60) {
            fluency = Math.min(fluency, lowestPhonemeScore);
        }

        let strictScore = Math.round((rawAverage * 0.3) + (lowestPhonemeScore * 0.5) + (fluency * 0.2));
        const strictErrors = wordData.filter(w => (Number(w.accuracy) || 100) < 90).map(w => ({ ...w, worstPhoneme: w.phonemes?.reduce((prev, curr) => (Number(prev.score) < Number(curr.score)) ? prev : curr) }));
        
        if (strictErrors.length > 0) strictScore -= (strictErrors.length * 6); 

        const cleanHeard = data.heard.toLowerCase().replace(/[^\w\s]/gi, '').trim();
        const cleanRef = text.toLowerCase().replace(/[^\w\s]/gi, '').trim();
        
        if (cleanHeard !== cleanRef) {
            strictScore -= 20; 
        }

        if (isNaN(strictScore)) strictScore = 0;
        strictScore = Math.max(0, Math.min(100, strictScore)); 

        if (strictScore >= 60 && strictScore <= 80) {
            strictScore += 4;
        } else if (strictScore > 95 && strictScore < 100) {
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
        let newCount = stats.count;
        if (!isPremium) newCount = stats.count - 1; 
        
        setStats({ count: newCount, xp: newXP });
        await supabase.from('user_stats').update({ daily_count: newCount, total_xp: newXP }).eq('email', user);
      } catch (err) { alert("Erro ao analisar: " + err.message); } finally { setIsProcessing(false); }
    };
  };

  const ProPaywall = () => (
    <div style={{ background: 'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 100%)', padding: '30px', borderRadius: '24px', color: 'white', textAlign: 'center', marginBottom: '20px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)', position: 'relative', animation: 'fadeIn 0.3s' }}>
        {(!isOutOfEnergy || planType === 'premium' || planType === 'pro') && (
            <button onClick={() => setShowProModal(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' }}>X</button>
        )}
        <h2 style={{ fontSize: '1.8rem', fontWeight: '900', margin: '0 0 10px 0' }}>{isOutOfEnergy ? "Vidas Esgotadas! ⚡" : "SotaQ PRO ⭐"}</h2>
        <p style={{ fontSize: '0.95rem', opacity: 0.9, marginBottom: '20px' }}>Domine seu sotaque e treine sem limites.</p>
        
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
    if (isRegistering) {
      return (
        <div style={{ background: '#f0f4f8', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '20px' }}>
          <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px', animation: 'fadeIn 0.3s' }}>
            <div style={{ textAlign: 'center', marginBottom: '25px' }}>
              <h1 style={{ color: '#1a2a6c', fontWeight: '900', fontSize: '2.2rem', margin: '0 0 5px 0' }}>SotaQ AI</h1>
              <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Crie sua conta gratuitamente.</p>
            </div>
            
            <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Seu Nome Completo..." style={{ width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', marginBottom: '15px', outline: 'none' }} />
            
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <select value={regCountryCode} onChange={(e) => setRegCountryCode(e.target.value)} style={{ width: '35%', padding: '15px 10px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none', background: 'white' }}>
                <option value="+55">🇧🇷 +55</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+351">🇵🇹 +351</option>
                <option value="+44">🇬🇧 +44</option>
              </select>
              <input type="tel" value={regPhone} onChange={(e) => setRegPhone(e.target.value.replace(/\D/g, ''))} placeholder="DDD + Número" style={{ width: '65%', boxSizing: 'border-box', padding: '15px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', outline: 'none' }} />
            </div>

            <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="Seu Email..." style={{ width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', marginBottom: '20px', outline: 'none' }} />
            
            <button onClick={handleRegister} disabled={isLoggingIn || !regName || !regPhone || !regEmail} style={{ width: '100%', background: (isLoggingIn || !regName || !regPhone || !regEmail) ? '#cbd5e1' : '#10b981', color: 'white', padding: '15px', borderRadius: '12px', border: 'none', fontWeight: '900', fontSize: '1.1rem', cursor: 'pointer', marginBottom: '15px', transition: '0.2s' }}>
              {isLoggingIn ? 'CADASTRANDO...' : 'CADASTRAR'}
            </button>
            
            <div style={{ textAlign: 'center' }}>
                <button onClick={() => setIsRegistering(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: 'bold', cursor: 'pointer', textDecoration: 'underline' }}>
                    Já tem conta? Faça Login
                </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ background: '#f0f4f8', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '20px' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px', animation: 'fadeIn 0.3s' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h1 style={{ color: '#1a2a6c', fontWeight: '900', fontSize: '2.2rem', margin: '0 0 5px 0' }}>SotaQ AI</h1>
            <p style={{ color: '#ff6a00', fontWeight: '800', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 8px 0' }}>
                Teste seu sotaque, melhore e compita com seus amigos!
            </p>
            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Acesse sua conta para treinar.</p>
          </div>
          
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Seu email..." style={{ width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '1rem', marginBottom: '20px', outline: 'none' }} />
          
          <button onClick={() => restoreSession(email)} disabled={isLoggingIn || !email} style={{ width: '100%', background: isLoggingIn ? '#cbd5e1' : '#ff6a00', color: 'white', padding: '15px', borderRadius: '12px', border: 'none', fontWeight: '900', fontSize: '1.1rem', cursor: 'pointer', marginBottom: '15px', transition: '0.2s' }}>
            {isLoggingIn ? 'ENTRANDO...' : 'ENTRAR'}
          </button>

          <div style={{ position: 'relative', textAlign: 'center', margin: '20px 0' }}>
            <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0' }} />
            <span style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: 'white', padding: '0 10px', color: '#94a3b8', fontSize: '0.85rem', fontWeight: 'bold' }}>OU</span>
          </div>

          <button onClick={() => setIsRegistering(true)} style={{ width: '100%', background: '#f1f5f9', color: '#0f172a', padding: '15px', borderRadius: '12px', border: '2px solid #e2e8f0', fontWeight: '900', fontSize: '1.1rem', cursor: 'pointer', transition: '0.2s' }}>
            CRIAR CONTA NOVA
          </button>
        </div>
      </div>
    );
  }

  const level = getLevelInfo(stats.xp);
  const isPremiumUser = planType === 'premium' || planType === 'pro';
  const isOutOfEnergy = !isPremiumUser && stats.count <= 0;

  let actionButtonProps = { text: '🎤 PRATICAR', bg: '#1a2a6c', onClick: startRecording, disabled: !text || text.trim().length === 0 };
  if (isProcessing) {
    actionButtonProps = { text: '⏳ AVALIANDO...', bg: '#f59e0b', onClick: null, disabled: true };
  } else if (isRecording) {
    actionButtonProps = { text: '🛑 PARAR (MÁX 5s)', bg: '#ef4444', onClick: stopRecording, disabled: false };
  } else if (feedback) {
    if (isPremiumUser && feedback.score < 75) {
      actionButtonProps = { text: '✨ TENTAR DE NOVO', bg: '#10b981', onClick: () => setFeedback(null), disabled: false };
    } else if (feedback.score >= 85) {
      actionButtonProps = { text: isCustomMode ? '✨ TENTAR DE NOVO' : '⏩ AVANÇAR', bg: '#10b981', onClick: isCustomMode ? () => setFeedback(null) : loadRandomPhrase, disabled: false };
    }
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
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#fef3c7', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⚡</div>
                <div>
                <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Energia Diária</strong>
                <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Usuários Grátis possuem <strong>7 vidas</strong> por dia. Assinantes <span onClick={() => { setShowRules(false); setShowProModal(true); }} style={{ color: '#ff6a00', fontWeight: '900', cursor: 'pointer', textDecoration: 'underline' }}>PRO ⭐</span> possuem Vidas Infinitas!</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#e0e7ff', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✍️</div>
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Modos de Treino</strong>
                  <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Gere frases <strong>Aleatórias</strong>. Usuários <span onClick={() => { setShowRules(false); setShowProModal(true); }} style={{ color: '#ff6a00', fontWeight: '900', cursor: 'pointer', textDecoration: 'underline' }}>PRO ⭐</span> podem <strong>Digitar</strong> suas próprias frases.</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#dcfce7', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔊</div>
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Calibre seu Ouvido</strong>
                  <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Escute a pronúncia nativa antes de gravar.</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div style={{ background: '#fee2e2', padding: '10px', borderRadius: '12px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎯</div>
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: '1rem', marginBottom: '2px' }}>Raio-X Implacável</strong>
                  <span style={{ color: '#475569', fontSize: '0.85rem', lineHeight: '1.4', display: 'block' }}>Nossa IA avalia sílabas microscópicas para apontar seu erro exato!</span>
                </div>
              </div>
            </div>
            <button onClick={() => setShowRules(false)} style={{ width: '100%', padding: '16px', background: '#1a2a6c', color: 'white', border: 'none', borderRadius: '16px', fontWeight: '900', fontSize: '1.05rem', cursor: 'pointer', boxShadow: '0 10px 15px -3px rgba(26, 42, 108, 0.3)', transition: '0.2s' }}>
              ENTENDI, VAMOS LÁ! 🚀
            </button>
          </div>
        </div>
      )}

      <nav style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '450px', margin: '0 auto' }}>
        <div onClick={() => setShowUserMenu(!showUserMenu)} style={{ cursor: 'pointer', position: 'relative' }}>
            <h1 style={{ fontSize: '1.2rem', fontWeight: '900', color: '#1a2a6c', margin: 0 }}>
              SotaQ {isPremiumUser ? <span style={{fontSize: '0.8rem', color: '#fbbf24', verticalAlign: 'middle'}}>PRO ⭐</span> : <span style={{fontSize: '0.7rem', color: '#ff6a00', verticalAlign: 'middle'}}>FREE</span>} ▼
            </h1>
            
            {showUserMenu && (
                <div style={{ position: 'absolute', top: '30px', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', boxShadow: '0 10px 15px rgba(0,0,0,0.1)', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {!isPremiumUser && <button onClick={() => { setShowProModal(true); setShowUserMenu(false); }} style={{ background: '#ff6a00', color: 'white', border: 'none', borderRadius: '8px', padding: '10px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center' }}>⭐ Upgrade PRO</button>}
                    <button onClick={handleLogout} style={{ background: '#fef2f2', border: 'none', color: '#ef4444', borderRadius: '8px', padding: '10px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center' }}>Sair da Conta 🚪</button>
                </div>
            )}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => setShowRules(true)} style={{ background: 'transparent', border: 'none', fontSize: '0.8rem', fontWeight: '800', color: '#64748b', cursor: 'pointer' }}>Regras</button>
          <div style={{ background: 'white', padding: '8px 16px', borderRadius: '50px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', fontWeight: '800', color: '#1a2a6c' }}>
            {isPremiumUser ? '⚡ ∞' : `⚡ ${stats.count}/${MAX_ENERGY}`}
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
                    <button onClick={handleCustomModeClick} style={{ background: isCustomMode ? '#ff6a00' : '#f1f5f9', color: isCustomMode ? 'white' : '#64748b', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer', transition: '0.2s' }}>
                      {isPremiumUser ? '✍️ DIGITAR' : '🔒 DIGITAR'}
                    </button>
                    <button onClick={playAudio} disabled={!text || text.trim() === ''} style={{ background: '#1a2a6c', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '50px', fontWeight: '900', fontSize: '0.7rem', cursor: 'pointer', opacity: text ? 1 : 0.5 }}>🔊 OUVIR</button>
                </div>
                {isCustomMode && isPremiumUser ? <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite em inglês..." maxLength={100} style={{ width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: '16px', border: '2px dashed #cbd5e1', fontSize: '1.2rem', fontWeight: 'bold', textAlign: 'center', minHeight: '100px', outline: 'none', resize: 'none' }} /> : 
                <><h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: '0 0 10px 0' }}>{text || "Escolha uma frase..."}</h2>{translation && <p style={{ color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>🇧🇷 "{translation}"</p>}</>}
            </div>

            {feedback && !isProcessing && (
              <div style={{ background: 'white', padding: '20px', borderRadius: '24px', textAlign: 'center', marginBottom: '20px', border: '2px solid #e2e8f0', animation: 'fadeIn 0.5s' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '5px', color: '#f59e0b' }}>{'★'.repeat(feedback.stars)}{'☆'.repeat(3 - feedback.stars)}</div>
                <p style={{ fontWeight: '900', color: '#1a2a6c', margin: '0 0 5px 0', fontSize: '1.4rem' }}>{feedback.score}% Precisão</p>
                <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 15px 0', fontStyle: 'italic' }}>🗣️ IA ouviu: "{feedback.heard}"</p>
                
                {isPremiumUser ? (
                  <div style={{ display: 'flex', justifyContent: 'space-around', margin: '15px 0', padding: '10px', background: '#f8fafc', borderRadius: '12px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Ritmo Bruto</span><strong style={{ color: '#334155' }}>{feedback.prosody}%</strong></div>
                      <div><span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Fluência</span><strong style={{ color: '#334155' }}>{feedback.fluency}%</strong></div>
                  </div>
                ) : (
                  <div onClick={() => setShowProModal(true)} style={{ margin: '15px 0', padding: '15px', background: '#f8fafc', borderRadius: '12px', cursor: 'pointer', border: '1px dashed #cbd5e1', opacity: 0.8 }}>
                      <span style={{ display: 'block', fontWeight: 'bold', color: '#64748b', fontSize: '0.9rem' }}>🔒 Ritmo & Fluência Ocultos</span>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>Toque para assinar o SotaQ PRO</span>
                  </div>
                )}

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

            {/* 🎓 THE HIGH-TICKET ACADEMY FUNNEL */}
            <div style={{ marginTop: '30px', textAlign: 'center', padding: '20px', background: 'white', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 10px 0', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Quer destravar sua fluência de vez?
              </p>
              <a href="https://idiomasquevedo.netlify.app/" target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'linear-gradient(90deg, #1a2a6c, #ff6a00)', color: 'white', padding: '14px', borderRadius: '16px', textDecoration: 'none', fontWeight: '900', fontSize: '1rem', transition: '0.2s' }}>
                <span>🎓 Conheça a Idiomas Quevedo</span>
                <span style={{ fontSize: '1.2rem' }}>➔</span>
              </a>
            </div>

          </>
        )}
      </div>
    </div>
  );
}
