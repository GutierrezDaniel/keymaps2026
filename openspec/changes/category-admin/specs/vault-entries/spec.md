# Delta for Vault Entries

## MODIFIED Requirements

### Requirement: Entry fields and categories

Each entry MUST support site name, link, password, email, username, and category. Category values MUST come from the repository-backed category set, which initially contains exactly `entretenimiento`, `trabajo`, `estudio`, and `servicios`; custom persisted values MUST also be accepted. (Previously: category validation used only the fixed initial allow-list.)

#### Scenario: Create a categorized entry

- GIVEN values for all six fields and one repository category
- WHEN the entry is created
- THEN it is stored and returned with those values

#### Scenario: Accept a repository-backed custom category

- GIVEN the repository contains `lectura` as a category
- WHEN an entry using `lectura` is created
- THEN creation succeeds
- AND an entry using a name absent from the repository is rejected

### Requirement: Search and filters

The system MUST support site-name search and filtering by category and email, and MUST combine active filters without exposing entries outside the result set. Category selectors in entry creation and editing MUST contain the repository-backed categories in alphabetical order; ordering ties MUST use the exact category name as a deterministic secondary key. The email filter MUST be presented as a selection of the distinct email values stored in the vault, with an explicit option to clear the filter and show all entries. (Previously: category values were fixed and their selector ordering was not specified.)

#### Scenario: Find a matching entry

- GIVEN multiple entries with different sites, categories, and emails
- WHEN a site search and category filter are applied
- THEN only entries matching both criteria are listed

#### Scenario: Email filter offers stored emails and can be cleared

- GIVEN entries with stored email addresses and a distinct-email selector
- WHEN the user picks one email and later selects the clear option
- THEN the list narrows to entries with that email and then returns to all entries

#### Scenario: No matching results

- GIVEN active search or filters with no matching entry
- WHEN the result list is rendered
- THEN an empty result is shown without an error

#### Scenario: Category selectors are ordered

- GIVEN repository categories with names that include an ordering tie
- WHEN an entry form is opened
- THEN its category options use alphabetical order and the deterministic tie-breaker

## ADDED Requirements

### Requirement: Category reference integrity

The system MUST cascade a confirmed category rename to every referencing entry and MUST refuse deletion while any entry references the category.

#### Scenario: Rename cascades after confirmation

- GIVEN entries referencing `work` and a rename confirmation showing their count
- WHEN the rename is confirmed
- THEN all those entries reference the new name

#### Scenario: Delete an in-use category

- GIVEN at least one entry references a category
- WHEN deletion is requested
- THEN the request fails and all entry references remain unchanged
