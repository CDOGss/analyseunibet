# 🤖 AnalyseUnibet - Simulateur de Paris Sportifs par IA

Ce projet est un outil d'intelligence stratégique et d'analyse de risque pour les paris sportifs. Il utilise l'intelligence artificielle **Gemini 3.8 Flash** de Google pour analyser les données du marché et proposer le pari combiné le plus "value" du jour.

Le système fonctionne **100% à blanc** (sans argent réel) afin d'évaluer la rentabilité à long terme de l'IA. 

## ✨ Fonctionnalités Principales

- **Data Réelle** : L'IA ne simule pas les événements. Elle récupère les vraies cotes du jour pour le Football et le Tennis grâce à *The-Odds-API*.
- **Veille Stratégique** : Avant de prendre une décision, le script scanne les derniers flux RSS sportifs (L'Équipe) pour comprendre le contexte des matchs (blessures, dynamique, enjeux).
- **Dashboard Premium** : Une interface moderne (React/Vite) qui suit la bankroll fictive, le taux de réussite (winrate) et le ROI à travers des graphiques interactifs (Chart.js).
- **100% Automatisé & Gratuit** : Grâce à GitHub Actions, le script Node.js se lance tous les jours à midi pour interroger Gemini. Les résultats sont sauvegardés directement dans ce dépôt GitHub sous forme de fichiers JSON, et l'interface web est mise à jour sur GitHub Pages. Aucun serveur externe n'est requis.

## 🚀 Installation & Déploiement

Ce projet est conçu pour être hébergé gratuitement sur votre propre compte GitHub.

### 1. Cloner ou Forker le projet
Assurez-vous que tout le code de ce dépôt est sur votre compte GitHub.

### 2. Configurer les clés API (Secrets)
L'IA a besoin de vos clés pour se connecter aux services. Allez dans les paramètres de votre dépôt GitHub : `Settings` > `Secrets and variables` > `Actions`.
Ajoutez les secrets suivants :
- `GEMINI_API_KEY` : Votre clé API Google AI Studio.
- `ODDS_API_KEY` : Votre clé API the-odds-api.com (le tier gratuit suffit).
- `RAPIDAPI_KEY` *(réservé)* : prévu pour la vérification des résultats tennis, mais le tennis est actuellement **désactivé** — le free tier de « Tennis API - ATP WTA ITF » n'expose les résultats que via H2H par IDs de joueurs (pas de résultats par date/nom). Le bot parie donc uniquement sur le football, dont les résultats sont vérifiables via the-odds-api.

### 3. Activer GitHub Pages
Allez dans `Settings` > `Pages` sur votre dépôt GitHub.
- Dans "Source", sélectionnez **GitHub Actions** (si vous souhaitez utiliser un workflow de build Vite) ou déployez manuellement le dossier `dist`.
*(Note : l'application peut aussi tourner localement avec `npm run dev` pour simplement visualiser le dashboard).*

## ⚙️ Fonctionnement Quotidien

Le fichier `.github/workflows/daily-bet.yml` lance le script chaque matin (plusieurs tentatives échelonnées avant midi, heure de La Réunion).
- Le script lit les flux RSS, télécharge les cotes des championnats de football actifs, et envoie le tout à Gemini 3.8 Flash avec un prompt strict d'analyste de risque.
- L'IA génère son combiné du jour, puis le code le **valide** contre la politique de mise (voir ci-dessous) ; un ticket hors politique est refusé et aucune mise n'est engagée ce jour-là.
- Le bot vérifie les résultats réels des tickets précédents, règle les gains/pertes, et effectue un "commit" automatique de `public/data/bets.json` et de la bankroll.

### 📐 Politique de mise (calibrée sur les résultats réels)
Après 238 sélections réelles (juillet → septembre 2026), le rendement observé par sélection est de **-3,8 %**, soit exactement la marge du bookmaker : l'IA n'a pas d'avantage détectable, et chaque sélection ajoutée au combiné multiplie cette perte (4 sélections ≈ -14 % attendu). D'où les règles appliquées **en code**, quoi que propose l'IA :
- **2 sélections maximum** par ticket (au lieu de 4).
- **Favoris uniquement** : cote de chaque sélection entre 1.15 et 1.60 — seule tranche non perdante dans nos données ; les cotes ≥ 2.00 perdaient -8 %.
- **Jamais deux fois le même match** : un match déjà engagé dans un ticket ouvert est exclu du pool. Auparavant, le même match ressortait 4 jours de suite et une seule défaite anéantissait plusieurs tickets (la moitié des mises était exposée à un même événement).
- **Championnats seulement**, pas de coupes : le marché 1X2 se règle sur 90 minutes et l'API renvoie le score après prolongation.
- **Fenêtre de 72 h** pour des résultats rapides ; si moins de 2 matchs exploitables, **pas de pari** (mieux vaut ne pas miser que miser à perte).

## 💻 Développement Local

Si vous souhaitez modifier le dashboard ou le script IA :

\`\`\`bash
# Installer les dépendances
npm install

# Lancer le Dashboard localement
npm run dev

# Tester le script de l'IA (nécessite les clés API en variable d'environnement)
npm run analyze
\`\`\`

---
*Avertissement : Ce projet est développé à des fins d'apprentissage, de test d'IA et de suivi statistique. Les jeux d'argent comportent des risques (endettement, dépendance).*

