# Vault UI Specification

## Purpose

Define the Spanish user experience for entry cards, the unified entry modal, secret masking, confirmations, and irreversible-loss warnings.

## Requirements

### Requirement: Spanish entry cards

The interface MUST present entries as summary cards with the site name and a category color chip, and MUST open the unified entry modal when the card is activated.

#### Scenario: Open an entry from a card

- GIVEN an unlocked vault with entry cards
- WHEN the user activates an entry card
- THEN the unified entry modal opens showing the six entry fields with Spanish labels

#### Scenario: No plaintext on cards

- GIVEN a locked or unlocked vault with entry cards
- WHEN entry cards are displayed
- THEN plaintext secrets are not displayed on the cards and the locked state is clear

### Requirement: Password masking and revealing

The password MUST be masked by default in the entry modal and MUST have an explicit reveal/hide toggle. Copy controls MAY be offered only for link, password, email, and username.

#### Scenario: Reveal and hide a password

- GIVEN the entry modal with a password
- WHEN the user activates reveal and then hide
- THEN the password is shown only while revealed and returns to masked form

#### Scenario: Non-copyable category

- GIVEN a displayed category field
- WHEN the user inspects available copy controls
- THEN no copy control is provided for the category

### Requirement: Unified entry modal

The entry modal MUST serve viewing, creating, and editing entries with the same sheet, MUST reset its fields each time it opens (a new entry starts empty, an edit starts from the entry's values), and MUST close when the entry it shows is deleted.

#### Scenario: New entry starts empty

- GIVEN a previous new-entry form was filled and saved
- WHEN the user opens the new-entry modal again
- THEN all fields are empty

#### Scenario: Edit prefills the entry

- GIVEN an existing entry
- WHEN the user opens the entry in the modal
- THEN the six fields are prefilled with the entry's values, including the decrypted password

#### Scenario: Delete closes the modal

- GIVEN the entry modal showing an existing entry
- WHEN the user confirms deletion of that entry
- THEN the modal closes after the entry is removed

#### Scenario: Category picker

- GIVEN the entry modal
- WHEN the user opens the category picker
- THEN the category options are displayed as a themed dropdown list and selecting one updates the entry category

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