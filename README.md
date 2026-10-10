# kzthvv

Bot Discord de vérification par téléphone, avec salon staff, code 4 chiffres, rôle automatique et logs.

Fonctionnement
- Un membre voit un panel avec le bouton `Verify`.
- Il clique et entre son numéro de téléphone dans une modal.
- Le numéro est envoyé dans un salon staff avec pseudo, ID, avatar et statut.
- Un staff peut `Claim` la demande puis `Envoyer le code`.
- Le code est envoyé en DM au membre.
- Le membre clique sur `Code` dans le panel et valide le code.
- Si le code est bon, le bot attribue automatiquement le rôle configuré et enregistre un log.

Commandes disponibles
- `!panel` : envoie le panel de vérification dans le salon actuel.
- La commande est réservée au staff / administrateur.

Variables d’environnement
- `DISCORD_TOKEN`
- `GUILD_ID`
- `STAFF_CHANNEL_ID`
- `LOGS_CHANNEL_ID`
- `VERIFIED_ROLE_NAME`
- `PING_EVERYONE_ON_VERIFY`
- `PORT`

Installation locale
```bash
npm install
cp .env.example .env
```

Puis remplir `.env`.

Lancer
```bash
npm start
```

Déploiement Render
- Créer un service Web
- Choisir `Docker`
- Brancher ce repository
- Ajouter les variables d’environnement depuis `.env.example`
- Exposition du port : `3000`

Important
- Le système est conçu pour fonctionner sans base de données. Tout est géré en mémoire.
- Si vous voulez changer les salons, les IDs ou le rôle, il suffit de modifier les variables d’environnement.
- Vous pouvez ajouter le salon staff, logs et le rôle via `.env`.
