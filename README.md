# 🤖 AnalyseUnibet - Simulateur de Paris Sportifs par IA

Ce projet est un outil d'intelligence stratégique et d'analyse de risque pour les paris sportifs. Il utilise l'intelligence artificielle **Gemini 3.1 Pro** de Google pour analyser les données du marché et proposer le pari combiné le plus "value" du jour.

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
Ajoutez les deux secrets suivants :
- `GEMINI_API_KEY` : Votre clé API Google AI Studio.
- `ODDS_API_KEY` : Votre clé API the-odds-api.com (le tier gratuit suffit).

### 3. Activer GitHub Pages
Allez dans `Settings` > `Pages` sur votre dépôt GitHub.
- Dans "Source", sélectionnez **GitHub Actions** (si vous souhaitez utiliser un workflow de build Vite) ou déployez manuellement le dossier `dist`.
*(Note : l'application peut aussi tourner localement avec `npm run dev` pour simplement visualiser le dashboard).*

## ⚙️ Fonctionnement Quotidien

Le fichier `.github/workflows/daily-bet.yml` est configuré avec l'instruction `cron: '0 12 * * *'`.
- Tous les jours à 12h00 UTC, les serveurs de GitHub s'allument.
- Ils lancent le script `scripts/daily_analysis.js`.
- Le script lit les flux RSS, télécharge les cotes, et envoie le tout à Gemini 3.1 Pro avec un prompt strict d'analyste de risque.
- L'IA génère son combiné du jour.
- Le bot effectue un "commit" automatique pour sauvegarder le résultat dans `public/data/bets.json` et mettre à jour la bankroll.

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
