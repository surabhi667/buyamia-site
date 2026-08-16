# Consignes permanentes pour Codex

Ce dépôt est `buyamia-site`. Les règles ci-dessous sont permanentes pour les prochaines sessions Codex.

## 1. Backend uniquement

- Travailler uniquement sur le backend, les API, la base de données, l'authentification, les validations, les migrations, les tests backend et la documentation technique.
- Ne jamais modifier le design, la mise en page, les couleurs, les textes, les images, les composants visuels, les styles CSS, les animations ou la navigation existante.
- Considérer tous les fichiers frontend comme étant en lecture seule.
- Si une modification frontend est absolument indispensable pour connecter une fonctionnalité au backend, s'arreter et demander d'abord l'autorisation de l'utilisateur.
- Dans ce cas, indiquer précisément le fichier concerné, la modification nécessaire et son impact. Ne pas la réaliser sans accord explicite.

## 2. Préservation du projet

- Utiliser l'architecture, les technologies et les conventions déjà présentes.
- Ne pas réécrire le projet et ne pas installer de nouvelle dépendance importante sans justification.
- Préserver toutes les modifications déjà présentes dans le dépôt.
- Ne supprimer aucune donnée ni migration existante.
- Ne lancer aucune commande destructive.
- Ne jamais révéler le contenu des fichiers `.env`, les clés API, les mots de passe, les tokens ou les secrets.
- Ne faire aucun commit, push ou déploiement sans autorisation explicite.

## 3. Méthode de travail

Avant chaque implémentation :

- Vérifier `git status`.
- Analyser le fonctionnement actuel.
- Expliquer brièvement ce qui va être fait.
- Indiquer les fichiers backend prévus pour modification.
- Indiquer les tests prévus.
- Travailler sur une seule fonctionnalité ou correction à la fois.

Après chaque implémentation, fournir obligatoirement un compte rendu sous cette forme :

```text
COMPTE RENDU DES CHANGEMENTS

* Fonctionnalité réalisée :
* Fichiers modifiés :
* Rôle de chaque fichier modifié :
* Routes API ajoutées ou modifiées :
* Modifications de la base de données :
* Migration créée :
* Validations et protections ajoutées :
* Tests exécutés :
* Résultats des tests :
* Confirmation que l'interface visuelle n'a pas été modifiée :
* Problèmes ou limites restantes :
* Prochaine étape backend recommandée :
```

Même lorsqu'aucun fichier n'a été modifié, l'indiquer explicitement.

## 4. Vérifications obligatoires

Après chaque intervention :

- Consulter le diff Git.
- Vérifier qu'aucun fichier d'interface, de style ou d'asset n'a été modifié.
- Exécuter les tests disponibles.
- Exécuter le lint, la vérification TypeScript et le build lorsqu'ils existent.
- Ne pas considérer le travail comme terminé si les vérifications échouent.
- Si une erreur existait déjà avant l'intervention, le préciser clairement.
