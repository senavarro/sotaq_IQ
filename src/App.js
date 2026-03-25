{/* THE VIP HANDBOOK - VERSION 2.0 (ACCENTS INCLUDED) */}
      {isModalOpen && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
          background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', 
          justifyContent: 'center', zIndex: 1000, padding: '15px', 
          backdropFilter: 'blur(8px)', boxSizing: 'border-box' 
        }}>
          <div style={{ 
            background: 'white', padding: '28px', borderRadius: '28px', 
            maxWidth: '420px', width: '100%', position: 'relative', 
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid #e2e8f0', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: '#f1f5f9', border: 'none', width: '32px', height: '32px', borderRadius: '50%', fontSize: '14px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            
            <h2 style={{ color: '#0f172a', marginTop: 0, fontSize: '1.4rem', fontWeight: '900', letterSpacing: '-0.5px' }}>
              Manual do Aluno VIP 🎓
            </h2>
            
            <div style={{ textAlign: 'left', marginTop: '15px' }}>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <span style={{ fontSize: '1.3rem' }}>🎲</span>
                <div>
                  <p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>1. Gere o Desafio</p>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Carregue frases reais ou palavras difíceis nos dados.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <span style={{ fontSize: '1.3rem' }}>🇺🇸</span>
                <div>
                  <p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>2. Escolha seu Sotaque</p>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Alterne entre USA e UK. A IA mudará a "orelha" para validar sua pronúncia específica.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <span style={{ fontSize: '1.3rem' }}>🔊</span>
                <div>
                  <p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>3. Ouça a Referência</p>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Escute no modo Normal ou Tartaruga para pegar os detalhes.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <span style={{ fontSize: '1.3rem' }}>🎤</span>
                <div>
                  <p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>4. Pratique e Pare</p>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Toque para gravar e **toque novamente para encerrar**. O Strict Mode não perdoa erros!</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <span style={{ fontSize: '1.3rem' }}>🏆</span>
                <div>
                  <p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>5. Ganhe XP e Bloqueie</p>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Acertos perfeitos (3★) bloqueiam a frase. Se já dominou, hora de evoluir para a próxima!</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <span style={{ fontSize: '1.3rem' }}>⚡</span>
                <div>
                  <p style={{ margin: 0, fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>6. Energia Diária</p>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>Você tem 12 energias por dia. Use cada uma com foco total.</p>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setIsModalOpen(false)} 
              style={{ 
                width: '100%', background: 'linear-gradient(135deg, #1a2a6c, #ff6a00)', 
                color: 'white', border: 'none', padding: '16px', borderRadius: '14px', 
                fontWeight: '900', marginTop: '20px', cursor: 'pointer', fontSize: '1rem'
              }}
            >
              ESTOU PRONTO
            </button>
          </div>
        </div>
      )}
