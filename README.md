# ScanLot

Prototype local de lecture de tickets et factures. Il n’a aucun lien avec ScanFac et ne modifie aucun de ses fichiers.

La version en ligne est publiée comme PWA sur GitHub Pages. Les scans, exports CSV et sauvegardes JSON de travail sont volontairement exclus de ce dépôt.

Pour l’essayer localement, depuis le dossier `dist`, lancer un serveur statique puis ouvrir l’adresse indiquée dans un navigateur récent :

```sh
python3 -m http.server 4173
```

Pour utiliser l’OCR, le navigateur télécharge les bibliothèques et modèles nécessaires lors de la première utilisation ; les documents importés ne sont pas téléversés.

Les résultats sont des propositions : contrôlez-les avant de les exporter. Le bouton « Texte lu » permet de distinguer une erreur de lecture OCR d’une erreur des règles d’interprétation. La sauvegarde JSON conserve les résultats et les noms des documents. Pour retrouver les PDF/images après une réinitialisation, placez-les dans le même dossier que le JSON, puis utilisez « Choisir dossier des documents » dans Chrome ou Edge.
