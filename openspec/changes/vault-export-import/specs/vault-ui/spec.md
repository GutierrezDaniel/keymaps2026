# Delta for Vault UI

## ADDED Requirements

### Requirement: Unlocked vault backup actions

The interface MUST show export and import actions in the unlocked vault header only. Export and import feedback, validation errors, and replacement confirmation MUST be presented in Spanish.

#### Scenario: Header actions while unlocked

- GIVEN an unlocked vault
- WHEN the vault header is displayed
- THEN export and import actions are visible
- AND activating either action opens its native dialog

#### Scenario: Actions hidden while locked

- GIVEN a locked vault or login screen
- WHEN the header or login view is displayed
- THEN export and import actions are not visible

### Requirement: Import replacement confirmation

Before replacing the current vault, the interface MUST show a Spanish confirmation modal that clearly states the current vault will be replaced and provides Cancel and Confirm actions.

#### Scenario: Confirm replacement modal

- GIVEN a selected file validated as an initialized vault
- WHEN import is ready to replace the current vault
- THEN a Spanish modal explains the replacement
- AND Cancel and Confirm actions are available

#### Scenario: Cancel from replacement modal

- GIVEN the replacement confirmation modal
- WHEN the user selects Cancel
- THEN the modal closes and the current vault remains available

### Requirement: Spanish backup feedback

The interface MUST show a Spanish success notice after a completed export and a Spanish error notice when export, selection, validation, or replacement fails.

#### Scenario: Successful export notice

- GIVEN an export completed at the selected destination
- WHEN the operation returns success
- THEN a Spanish success notice is displayed

#### Scenario: Failed import notice

- GIVEN import selection or replacement fails
- WHEN the operation returns an error
- THEN a Spanish error notice is displayed
