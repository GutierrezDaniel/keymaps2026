# Category Administration Specification

## Purpose

Define user-managed category administration, including access, validation, ordering, colors, rename confirmation, and deletion safeguards.

## Requirements

### Requirement: Category administration access and ordering

When the vault is unlocked, the system MUST provide an “Administrar categorías” button in the vault header. Activating it MUST open an administration modal whose categories are shown alphabetically; comparison ties MUST use the exact category name as a deterministic secondary key.

#### Scenario: Open the administration modal

- GIVEN an unlocked vault
- WHEN the user activates “Administrar categorías”
- THEN the category administration modal opens
- AND its categories are displayed in deterministic alphabetical order

#### Scenario: Resolve ordering ties

- GIVEN categories whose case-normalized names compare equally
- WHEN the modal list is rendered
- THEN the exact category names are used as the secondary ordering key

### Requirement: Category creation and validation

The system MUST allow a user to create a category with a non-empty name and one of at least 20 predefined color swatches. Names MUST be compared exactly for duplicate detection; an exact duplicate, an empty or whitespace-only name, and a color outside the predefined palette MUST be rejected without changing categories.

#### Scenario: Create a valid category

- GIVEN a unique non-empty name and a predefined swatch
- WHEN the user confirms creation
- THEN the category is persisted and available to entry forms

#### Scenario: Reject invalid category input

- GIVEN an exact duplicate name, blank name, or invalid color
- WHEN creation is requested
- THEN validation fails and no category is created

### Requirement: Category rename confirmation and cascade

The system MUST require confirmation before renaming a category and MUST report the number of affected entries in that confirmation. On confirmation, every entry using the old name MUST use the new name; cancellation MUST leave the category and entries unchanged.

#### Scenario: Confirm an in-use rename

- GIVEN a category referenced by three entries
- WHEN the user requests a rename and confirms after seeing “3 affected entries”
- THEN the category is renamed and all three entries reference the new name

#### Scenario: Cancel a rename

- GIVEN a pending rename confirmation
- WHEN the user cancels
- THEN the original category name and every entry reference remain unchanged

### Requirement: Safe category deletion

The system MUST allow deletion only when no entry references the category and at least one other category remains. The delete control for an in-use category MUST be disabled with an explanatory tooltip, and the service MUST refuse the deletion if attempted through another interface. Seed categories MUST be deletable when unused.

#### Scenario: Refuse an in-use category

- GIVEN a category referenced by an entry
- WHEN the administration modal is rendered
- THEN its trash control is disabled and explains that entries still use the category
- AND a deletion request cannot remove it

#### Scenario: Protect the last category

- GIVEN a vault containing exactly one category with no entries
- WHEN deletion is requested
- THEN deletion is refused and the category remains available

### Requirement: Immediate category recoloring

The system MUST allow changing a category to any predefined swatch and MUST apply the new color immediately to all existing entry cards using that category.

#### Scenario: Recolor existing cards

- GIVEN entry cards using a category
- WHEN the user selects and saves a different predefined swatch
- THEN the category color and all matching cards update immediately
