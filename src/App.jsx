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
import { TrendingUp, Wallet, CheckCircle, Clock } from 'lucide-react';

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

function App() {
  const [bankroll, setBankroll] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

    fetchData();
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: '5rem' }}>Chargement de l'IA...</div>;
  }

  if (!bankroll) {
    return <div style={{ textAlign: 'center', marginTop: '5rem' }}>Aucune donnée disponible.</div>;
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

  const chartData = {
    labels: bankroll.history.map(entry => entry.date),
    datasets: [
      {
        label: 'Bankroll (€)',
        data: bankroll.history.map(entry => entry.amount),
        borderColor: isPositive ? '#00e676' : '#ff1744',
        backgroundColor: isPositive ? 'rgba(0, 230, 118, 0.1)' : 'rgba(255, 23, 68, 0.1)',
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
        backgroundColor: 'rgba(25, 28, 41, 0.9)',
        titleColor: '#fff',
        bodyColor: '#a0a5b1',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1
      },
    },
    scales: {
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
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
      <h1>Gemini <span className="text-gradient">Betting AI</span></h1>

      <div className="dashboard-grid">
        <div className="glass-card">
          <div className="stat-label"><Wallet size={16} style={{display: 'inline', marginRight: '8px'}}/>Bankroll Actuelle</div>
          <div className="stat-value">{bankroll.current.toFixed(2)} €</div>
          <div className={isPositive ? 'positive' : 'negative'} style={{fontSize: '0.9rem', fontWeight: 600}}>
            {isPositive ? '+' : ''}{profit.toFixed(2)} € (ROI: {roi}%)
          </div>
        </div>

        <div className="glass-card">
          <div className="stat-label"><TrendingUp size={16} style={{display: 'inline', marginRight: '8px'}}/>Taux de réussite</div>
          <div className="stat-value">{winRate}%</div>
          <div style={{color: 'var(--text-secondary)', fontSize: '0.9rem'}}>
            Sur {resolvedBets.length} paris terminés
          </div>
        </div>
      </div>

      <div className="glass-card chart-container">
        <h2 style={{fontSize: '1.2rem', marginBottom: '1rem'}}>Évolution du Capital</h2>
        <div style={{height: '320px'}}>
          <Line data={chartData} options={chartOptions} />
        </div>
      </div>

      <h2 style={{marginTop: '3rem'}}>Historique des Paris</h2>
      <div className="bets-container">
        {bets.length === 0 ? (
          <p style={{color: 'var(--text-secondary)'}}>Aucun pari enregistré pour le moment.</p>
        ) : (
          bets.map(bet => (
            <div key={bet.id} className="glass-card bet-item">
              <div className="bet-header">
                <div>
                  <strong>Pari du {new Date(bet.date).toLocaleDateString('fr-FR')}</strong>
                  <span style={{color: 'var(--text-secondary)', marginLeft: '1rem'}}>Mise: {bet.mise.toFixed(2)}€</span>
                </div>
                <span className={`badge ${bet.statut}`}>
                  {bet.statut === 'en_attente' && <Clock size={12} style={{display: 'inline', marginRight: '4px'}} />}
                  {bet.statut === 'gagné' && <CheckCircle size={12} style={{display: 'inline', marginRight: '4px'}} />}
                  {bet.statut.replace('_', ' ')}
                </span>
              </div>
              
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span style={{color: 'var(--accent-primary)', fontWeight: 600}}>Cote Totale: {bet.cote_totale}</span>
                <span style={{color: 'var(--text-secondary)'}}>Gain Potentiel: {bet.gain_potentiel}€</span>
              </div>

              <ul className="selections-list">
                {bet.selections.map((sel, idx) => (
                  <li key={idx} className="selection-item">
                    <span>{sel.match}</span>
                    <span>
                      <strong style={{color: '#fff', marginRight: '1rem'}}>Choix: {sel.choix}</strong>
                      <span style={{color: 'var(--accent-secondary)'}}>(Cote: {sel.cote})</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="analysis-box">
                <strong style={{display: 'block', marginBottom: '0.5rem', color: '#fff'}}>Analyse de l'IA :</strong>
                {bet.analyse}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
