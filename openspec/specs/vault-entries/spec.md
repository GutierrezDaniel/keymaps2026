# Vault Entries Specification

## Purpose

Define entry data, categories, CRUD operations, discovery, and safe value copying.

## Requirements

### Requirement: Entry fields and categories

Each entry MUST support site name, link, password, email, username, and category. The initial valid categories MUST be exactly `entretenimiento`, `trabajo`, `estudio`, and `servicios`; the category model MUST allow future custom values without a schema-breaking change.

#### Scenario: Create a categorized entry

- GIVEN values for all six fields and one initial category
- WHEN the entry is created
- THEN it is stored and returned with those values

#### Scenario: Reject an invalid category

- GIVEN an entry using a category outside the currently valid set
- WHEN creation is requested before custom-category support exists
- THEN validation fails and no entry is created

### Requirement: Entry CRUD and deletion confirmation

The system MUST support creating, reading, updating, and deleting entries by stable record ID. Deletion MUST require explicit confirmation and cancellation MUST preserve the entry.

#### Scenario: Update and delete an entry

- GIVEN an existing entry
- WHEN it is updated and deletion is confirmed
- THEN the update is persisted and the selected record is removed

#### Scenario: Cancel deletion

- GIVEN an existing entry and an open delete confirmation
- WHEN deletion is cancelled
- THEN the entry remains unchanged and available

### Requirement: Search and filters

The system MUST support site-name search and filtering by category and email, and MUST combine active filters without exposing entries outside the result set.

#### Scenario: Find a matching entry

- GIVEN multiple entries with different sites, categories, and emails
- WHEN a site search and category filter are applied
- THEN only entries matching both criteria are listed

#### Scenario: No matching results

- GIVEN active search or filters with no matching entry
- WHEN the result list is rendered
- THEN an empty result is shown without an error

### Requirement: Clipboard expiration

The system MUST allow copying link, password, email, and username values, and MUST automatically clear each copied value from the clipboard after 20 seconds.

#### Scenario: Copy an allowed value

- GIVEN an unlocked entry
- WHEN the user copies its password
- THEN the clipboard contains that value temporarily
- AND it is cleared no later than 20 seconds after copying

#### Scenario: Copy is unavailable while locked

- GIVEN a locked vault
- WHEN a copy operation is requested
- THEN no secret value is placed on the clipboard
