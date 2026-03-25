# AGENT ENGINEERING RULES (BACKEND)

## 1. Core Principle

Always prioritize **code stability, consistency, and non-breaking changes**.

Do not introduce changes that:

- Break existing functionality
- Conflict with current architecture
- Ignore established patterns in the codebase

---

## 2. Before Writing Any Code

### 2.1 Understand Context

- Read related files fully before editing
- Identify similar implementations of the same feature
- Follow existing patterns (naming, structure, logic)

### 2.2 Analyze Impact

- Check where the code is used (imports, references)
- Identify possible side effects
- Avoid modifying shared logic unless necessary

---

## 3. Implementation Rules

### 3.1 Follow Existing Patterns

- Match coding style already used
- Reuse existing utilities/functions where possible
- Do not introduce new patterns if an existing one works

### 3.2 Keep Changes Minimal

- Only change what is required
- Avoid unnecessary refactoring
- Do not rename variables/functions unless required

### 3.3 Maintain Compatibility

- Ensure backward compatibility
- Do not remove or alter existing public interfaces without checks

---

## 4. Backend-Specific Rules

- Do not break API contracts
- Validate all inputs and outputs
- Preserve database schema integrity
- Avoid unsafe queries or mutations
- Ensure proper authentication and authorization handling
- Maintain consistent response structure across endpoints

---

## 5. Postman Documentation (MANDATORY)

### 5.1 Initial Setup

- If no API documentation exists in the root folder:
  - Create a `/postman` directory
  - Include Postman collection JSON files

### 5.2 Environments

Create **3 environments**:

- `local`
- `staging`
- `production`

Each environment must include:

- Base URL
- Auth tokens (if applicable)
- Environment-specific variables

---

### 5.3 Endpoint Documentation

For **every endpoint**:

- Include:
  - Request method (GET, POST, etc.)
  - URL
  - Headers
  - Body (if applicable)
  - Sample responses
  - Error responses

- Use realistic example data
- Keep naming consistent with backend routes

---

### 5.4 Authentication Handling

- When a user signs in:
  - Store token in Postman environment
  - Use token for protected routes

- Clearly mark:
  - Public endpoints
  - Protected endpoints

---

### 5.5 Maintenance Rules

- If any controller or route is:
  - Added
  - Updated
  - Modified

→ You MUST update the Postman collection

- Ensure documentation always reflects current behavior

---

## 6. Code Safety Checks

Before finalizing any change, ensure:

- No syntax errors
- No unused imports or variables
- No broken references
- No duplicated logic introduced

---

## 7. Testing (MANDATORY)

### 7.1 Test Inside the Agent Only

- Do NOT rely on browser or external/manual testing
- Create temporary test logic within the codebase

### 7.2 How to Test

- Write small temporary tests (unit-style or inline)
- Validate:
  - Expected inputs → correct outputs
  - Edge cases handled properly

### 7.3 Cleanup

- Remove all temporary test code after validation
- Do not leave debug logs or test artifacts

---

## 8. Regression Prevention

- Re-check previously working features affected by the change
- Ensure nothing else is broken
- If unsure, avoid risky modifications

---

## 9. Error Handling

- Always handle possible failure cases
- Do not silently fail
- Use existing error handling patterns

---

## 10. Logging & Debugging

- Add logs only if necessary
- Remove temporary logs after testing
- Do not expose sensitive data in logs

---

## 11. When Unsure

- Do not guess
- Follow existing implementation as reference
- Choose the safest, least disruptive option

---

## 12. Definition of Done

A task is complete only if:

- Feature works as expected
- No existing functionality is broken
- Code follows existing patterns
- Postman documentation is updated (if applicable)
- Temporary test code is removed
- No side effects introduced