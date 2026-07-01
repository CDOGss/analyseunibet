import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { TrendingUp, Wallet, CheckCircle, Clock, XCircle, Target, Sparkles } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Associe une clé de sport à ses émojis, couleurs de fond et styles de bordure.
function getSport(sportKey) {
  const k = (sportKey || '').toLowerCase();
  if (k.includes('tennis')) {
    return {
      emoji: '🎾',
      player: '🧑‍🎾',
      label: 'Tennis',
      bgGradient: 'linear-gradient(135deg, rgba(211, 84, 0, 0.12) 0%, rgba(25, 28, 41, 0.8) 100%)',
      borderColor: 'rgba(211, 84, 0, 0.3)',
      accentColor: '#e67e22'
    };
  }
  if (k.includes('soccer') || k.includes('football') || k.includes('foot')) {
    return {
      emoji: '⚽',
      player: '🧑‍⚽',
      label: 'Football',
      bgGradient: 'linear-gradient(135deg, rgba(39, 174, 96, 0.12) 0%, rgba(25, 28, 41, 0.8) 100%)',
      borderColor: 'rgba(39, 174, 96, 0.3)',
      accentColor: '#2ecc71'
    };
  }
  if (k.includes('basket')) {
    return {
      emoji: '🏀',
      player: '🧑‍🏀',
      label: 'Basketball',
      bgGradient: 'linear-gradient(135deg, rgba(230, 126, 34, 0.12) 0%, rgba(25, 28, 41, 0.8) 100%)',
      borderColor: 'rgba(230, 126, 34, 0.3)',
      accentColor: '#f39c12'
    };
  }
  if (k.includes('rugby')) {
    return {
      emoji: '🏉',
      player: '🏃‍♂️',
      label: 'Rugby',
      bgGradient: 'linear-gradient(135deg, rgba(139, 69, 19, 0.12) 0%, rgba(25, 28, 41, 0.8) 100%)',
      borderColor: 'rgba(139, 69, 19, 0.3)',
      accentColor: '#d35400'
    };
  }
  if (k.includes('hockey')) {
    return {
      emoji: '🏒',
      player: '🏃‍♂️🏒',
      label: 'Hockey',
      bgGradient: 'linear-gradient(135deg, rgba(52, 152, 219, 0.12) 0%, rgba(25, 28, 41, 0.8) 100%)',
      borderColor: 'rgba(52, 152, 219, 0.3)',
      accentColor: '#3498db'
    };
  }
  if (k.includes('handball')) {
    return {
      emoji: '🤾',
      player: '🤾‍♂️',
      label: 'Handball',
      bgGradient: 'linear-gradient(135deg, rgba(155, 89, 182, 0.12) 0%, rgba(25, 28, 41, 0.8) 100%)',
      borderColor: 'rgba(155, 89, 182, 0.3)',
      accentColor: '#9b59b6'
    };
  }
  return {
    emoji: '🏆',
    player: '🏆',
    label: 'Autre Sport',
    bgGradient: 'linear-gradient(135deg, rgba(142, 68, 173, 0.15) 0%, rgba(25, 28, 41, 0.8) 100%)',
    borderColor: 'rgba(142, 68, 173, 0.3)',
    accentColor: '#9b59b6'
  };
}

const STATUS_META = {
  en_attente: { label: 'En attente', icon: Clock, cls: 'pending' },
  gagné: { label: 'Gagné', icon: CheckCircle, cls: 'won' },
  perdu: { label: 'Perdu', icon: XCircle, cls: 'lost' },
};

const ANALYSIS_STEPS = [
  "Initialisation du module IA (Gemini 3.5 Flash)...",
  "Lecture des actualités (Blessures & Dynamiques)...",
  "Comparaison des cotes en direct (The-Odds-API)...",
  "Simulation de risques et de Bankroll...",
  "Rédaction de l'analyse et sélection du combiné...",
  "Finalisation et mise à jour de l'historique !"
];

function SelectionRow({ sel }) {
  const sport = getSport(sel.sport);
  const parts = String(sel.match).split(/\s+vs\s+/i);
  const isTennis = sport.label === 'Tennis';
  
  const team1 = parts[0] || 'Équipe 1';
  const team2 = parts[1] || 'Équipe 2';
  
  return (
    <div className="selection-ticket" style={{ borderLeft: `4px solid ${sport.accentColor}` }}>
      <div className="selection-ticket-header">
        <span className="sport-badge" style={{ backgroundColor: `${sport.accentColor}20`, color: sport.accentColor }}>
          <span className="sport-player-emoji">{sport.player}</span>
          <span className="sport-label-text">{sport.label}</span>
        </span>
        <span className="match-name">{sel.match}</span>
      </div>
      
      <div className="bet-buttons-container">
        {/* Choix 1 */}
        <div className={`bet-button ${sel.choix === '1' ? 'ai-selected' : 'disabled'}`}>
          <span className="bet-button-label">
            {sport.label === 'Football' ? '⚽ ' : sport.label === 'Tennis' ? '🎾 ' : ''}
            {team1}
          </span>
          <span className="bet-button-value">{sel.cote.toFixed(2)}</span>
          {sel.choix === '1' && <span className="ai-badge">PICK IA</span>}
        </div>
        
        {/* Choix N (si pas Tennis) */}
        {!isTennis && (
          <div className={`bet-button ${sel.choix === 'N' ? 'ai-selected' : 'disabled'}`}>
            <span className="bet-button-label">🤝 Nul</span>
            <span className="bet-button-value">{sel.choix === 'N' ? sel.cote.toFixed(2) : '—'}</span>
            {sel.choix === 'N' && <span className="ai-badge">PICK IA</span>}
          </div>
        )}
        
        {/* Choix 2 */}
        <div className={`bet-button ${sel.choix === '2' ? 'ai-selected' : 'disabled'}`}>
          <span className="bet-button-label">
            {sport.label === 'Football' ? '⚽ ' : sport.label === 'Tennis' ? '🎾 ' : ''}
            {team2}
          </span>
          <span className="bet-button-value">{sel.cote.toFixed(2)}</span>
          {sel.choix === '2' && <span className="ai-badge">PICK IA</span>}
        </div>
      </div>
    </div>
  );
}

function BetCard({ bet, highlight }) {
  const meta = STATUS_META[bet.statut] || STATUS_META.en_attente;
  const StatusIcon = meta.icon;
  
  // Utilise le dégradé du premier sport présent dans les sélections pour colorer le ticket
  const primarySportKey = bet.selections[0]?.sport;
  const sportMeta = getSport(primarySportKey);
  
  return (
    <div 
      className={`glass-card bet-item ${highlight ? 'bet-highlight' : ''}`}
      style={{ 
        background: sportMeta.bgGradient,
        borderColor: highlight ? 'var(--accent-primary)' : sportMeta.borderColor
      }}
    >
      <div className="bet-header">
        <div>
          <strong className="bet-title">Ticket Combiné du {new Date(bet.date).toLocaleDateString('fr-FR')}</strong>
          <span className="bet-stake">Mise : {bet.mise.toFixed(2)} €</span>
        </div>
        <span className={`badge ${meta.cls}`}>
          <StatusIcon size={13} /> {meta.label}
        </span>
      </div>

      <div className="selections-list">
        {bet.selections.map((sel, idx) => (
          <SelectionRow key={idx} sel={sel} />
        ))}
      </div>

      <div className="bet-footer">
        <span className="cote-totale">Cote totale&nbsp;<strong>{bet.cote_totale}</strong></span>
        <span className="gain-potentiel">Gain potentiel&nbsp;<strong>{bet.gain_potentiel} €</strong></span>
      </div>

      <div className="analysis-box">
        <strong className="analysis-title">🧠 Analyse Prédictive de l'IA</strong>
        <p>{bet.analyse}</p>
      </div>
    </div>
  );
}

function App() {
  const [bankroll, setBankroll] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);

  const fetchData = async () => {
    try {
      const bankrollRes = await fetch('/data/bankroll.json');
      const bankrollData = await bankrollRes.json();

      const betsRes = await fetch('/data/bets.json');
      const betsData = await betsRes.json();

      setBankroll(bankrollData);
      setBets(betsData);
    } catch (error) {
      console.error("Erreur lors du chargement des données", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisStep(0);
    
    // Fait progresser les étapes simulées pour garder l'utilisateur engagé
    const interval = setInterval(() => {
      setAnalysisStep(prev => (prev < 4 ? prev + 1 : prev));
    }, 1200);

    try {
      const response = await fetch('/api/run-analysis', {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error("L'API d'analyse a renvoyé une erreur.");
      }

      setAnalysisStep(5);
      
      setTimeout(async () => {
        clearInterval(interval);
        await fetchData();
        setIsAnalyzing(false);
      }, 1500);
      
    } catch (error) {
      console.error(error);
      clearInterval(interval);
      alert("Erreur lors de l'exécution de la prédiction : " + error.message);
      setIsAnalyzing(false);
    }
  };

  if (loading) {
    return <div className="centered-msg">Chargement du cerveau prédictif...</div>;
  }

  if (!bankroll) {
    return <div className="centered-msg">Aucune donnée de bankroll disponible.</div>;
  }

  const profit = bankroll.current - bankroll.initial;
  const roi = ((profit / bankroll.initial) * 100).toFixed(2);
  const isPositive = profit >= 0;

  // Calcul du winrate (paris terminés uniquement)
  const resolvedBets = bets.filter(b => b.statut !== 'en_attente');
  const wonBets = resolvedBets.filter(b => b.statut === 'gagné');
  const winRate = resolvedBets.length > 0
    ? ((wonBets.length / resolvedBets.length) * 100).toFixed(1)
    : 0;

  const pendingBets = bets.filter(b => b.statut === 'en_attente');
  const historyBets = bets.filter(b => b.statut !== 'en_attente');

  const chartData = {
    labels: bankroll.history.map(entry => entry.date),
    datasets: [
      {
        label: 'Bankroll (€)',
        data: bankroll.history.map(entry => entry.amount),
        borderColor: isPositive ? '#00e676' : '#ff1744',
        backgroundColor: isPositive ? 'rgba(0, 230, 118, 0.08)' : 'rgba(255, 23, 68, 0.08)',
        fill: true,
        tension: 0.4,
      }
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(25, 28, 41, 0.95)',
        titleColor: '#fff',
        bodyColor: '#a0a5b1',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1
      },
    },
    scales: {
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.04)' },
        ticks: { color: '#a0a5b1' }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#a0a5b1' }
      }
    }
  };

  return (
    <div className="animate-fade-in">
      <header className="app-header">
        <h1>Gemini <span className="text-gradient">Betting AI</span></h1>
        
        <button 
          className={`btn-primary run-analysis-btn ${isAnalyzing ? 'loading' : ''}`}
          onClick={handleRunAnalysis}
          disabled={isAnalyzing}
        >
          <Sparkles size={18} className={isAnalyzing ? 'spin-icon' : ''} />
          {isAnalyzing ? "Analyse Gemini..." : "Lancer l'Analyse de l'IA"}
        </button>
      </header>

      {/* Overlay de chargement dynamique */}
      {isAnalyzing && (
        <div className="analysis-overlay">
          <div className="analysis-overlay-card glass-card">
            <div className="spinner-container">
              <div className="glow-spinner"></div>
            </div>
            <h3>Cerveau Gemini en Action</h3>
            <p className="overlay-subtitle">Traitement de l'algorithme prédictif quotidien</p>
            <div className="analysis-steps-list">
              {ANALYSIS_STEPS.map((step, idx) => {
                let status = 'pending';
                if (idx < analysisStep) status = 'completed';
                else if (idx === analysisStep) status = 'active';
                return (
                  <div key={idx} className={`analysis-step-row ${status}`}>
                    <span className="step-bullet">
                      {status === 'completed' ? '✓' : status === 'active' ? '⚡' : '○'}
                    </span>
                    <span className="step-text">{step}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        <div className="glass-card">
          <div className="stat-label"><Wallet size={16} />Bankroll actuelle</div>
          <div className="stat-value">{bankroll.current.toFixed(2)} €</div>
          <div className={isPositive ? 'positive' : 'negative'} style={{ fontSize: '0.9rem', fontWeight: 600 }}>
            {isPositive ? '+' : ''}{profit.toFixed(2)} € (ROI : {roi}%)
          </div>
        </div>

        <div className="glass-card">
          <div className="stat-label"><TrendingUp size={16} />Taux de réussite</div>
          <div className="stat-value">{winRate}%</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Sur {resolvedBets.length} paris terminés
          </div>
        </div>
      </div>

      <div className="glass-card chart-container">
        <h2 className="section-title" style={{ marginTop: 0 }}>Évolution du capital</h2>
        <div style={{ height: '300px' }}>
          <Line data={chartData} options={chartOptions} />
        </div>
      </div>

      <h2 className="section-title with-icon"><Target size={22} /> Paris à placer aujourd'hui</h2>
      <div className="bets-container">
        {pendingBets.length === 0 ? (
          <p className="empty-msg">Aucun pari en attente. L'IA n'a pas encore joué aujourd'hui.</p>
        ) : (
          pendingBets.map(bet => <BetCard key={bet.id} bet={bet} highlight />)
        )}
      </div>

      <h2 className="section-title">Historique des paris</h2>
      <div className="bets-container">
        {historyBets.length === 0 ? (
          <p className="empty-msg">Aucun pari terminé pour le moment.</p>
        ) : (
          historyBets.map(bet => <BetCard key={bet.id} bet={bet} />)
        )}
      </div>
    </div>
  );
}

export default App;
