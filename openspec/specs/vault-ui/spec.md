# Vault UI Specification

## Purpose

Define the Spanish user experience for entry cards, forms, secret masking, confirmations, and irreversible-loss warnings.

## Requirements

### Requirement: Spanish entry cards

The user interface MUST present entries as cards with Spanish labels and MUST provide a flip animation that reveals site name, link, password, email, username, and category on the detail side.

#### Scenario: Flip an entry card

- GIVEN an unlocked entry card
- WHEN the user activates the card flip
- THEN the detail side shows all six entry fields with Spanish labels

#### Scenario: Locked card

- GIVEN a locked vault
- WHEN entry cards are displayed
- THEN plaintext secrets are not displayed and the locked state is clear

### Requirement: Password masking and copying

The password MUST be masked by default on the detail side and MUST have an explicit reveal/hide toggle. Copy controls MAY be offered only for link, password, email, and username.

#### Scenario: Reveal and hide a password

- GIVEN a flipped entry card with a password
- WHEN the user activates reveal and then hide
- THEN the password is shown only while revealed and returns to masked form

#### Scenario: Non-copyable category

- GIVEN a displayed category field
- WHEN the user inspects available copy controls
- THEN no copy control is provided for the category

### Requirement: Spanish irreversible-loss warnings

The interface MUST show a prominent Spanish warning before vault creation that losing the master password is irreversible and prevents recovery, and MUST show an equivalent prominent warning whenever the vault is locked.

#### Scenario: Vault creation warning

- GIVEN the vault-creation screen
- WHEN it is displayed before master-password confirmation
- THEN the irreversible-loss warning is visible in Spanish

#### Scenario: Locked-state warning

- GIVEN a locked vault
- WHEN the locked screen is displayed
- THEN the Spanish warning about permanent master-password loss is prominent

### Requirement: Form validation and deletion confirmation

Entry forms MUST identify required or invalid values in Spanish, and deletion controls MUST present a Spanish confirmation step before removal.

#### Scenario: Invalid entry form

- GIVEN an entry form with a missing required field
- WHEN submission is attempted
- THEN the form remains open and a Spanish validation message identifies the problem

#### Scenario: Confirm deletion

- GIVEN an existing entry
- WHEN the user selects delete
- THEN a Spanish confirmation prompt appears before the entry is removed
