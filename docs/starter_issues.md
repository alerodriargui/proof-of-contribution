# Starter Issues Templates

This document contains templates for initial `good first issue` and `help wanted` tasks. Maintainers can copy and paste these directly when creating new GitHub issues.

---

## 1. Add a New Ecosystem Configuration

*   **Title**: `feat: add a new crypto organization/ecosystem to scraper configuration`
*   **Labels**: `enhancement`, `good first issue`
*   **Description**:

    Currently, the project tracks several organizations such as Ethereum, Bitcoin, Uniswap, and Solana. We want to expand our coverage by adding a new organization (for example, `cosmos` or `optimism`).

    ### Tasks
    1. Open [refresh_data.py](file:///scripts/refresh_data.py).
    2. Add the new organization to the `NETWORKS` tuple. For example:
       ```python
       ("cosmos", "cosmos")
       ```
    3. Run a smoke test scan locally:
       ```powershell
       python .\ethereum_pr_counter.py --org cosmos --max-repos 1 --events-only --pr-output data/cosmos_merged_prs.csv
       ```
    4. Run `python scripts/refresh_data.py` to ensure it completes successfully.
    5. Run `python scripts/validate_data.py` and verify all tests pass.
    6. Commit the changes and the newly generated data files.

---

## 2. Improve Empty and Loading States in the Dashboard

*   **Title**: `ux: improve loading and empty states in the interactive dashboard`
*   **Labels**: `frontend`, `UX`, `good first issue`
*   **Description**:

    When the interactive dashboard loads, it parses JSON and CSV datasets. Depending on the user's connection, there can be a brief flash of unstyled or empty content. We want to make this transition smoother.

    ### Tasks
    1. Locate the frontend files under [app/](file:///app).
    2. Add a clear, visually appealing loading spinner or skeleton UI state in `index.html` while datasets are being fetched and parsed by Javascript.
    3. Add a fallback message if a user searches for an organization or contributor that has no results (an empty state).
    4. Ensure the dashboard's design feels premium and matches the rest of the application aesthetics.

---

## 3. Add a Contributor Search Field

*   **Title**: `feat: add a search input to filter contributors by username`
*   **Labels**: `frontend`, `enhancement`, `help wanted`
*   **Description**:

    As the list of contributors grows, it becomes harder to find a specific developer's contributions. We need a search input box in the dashboard that filters contributors dynamically as the user types.

    ### Tasks
    1. Add an input field to the user interface in [app/index.html](file:///app/index.html).
    2. Update the Javascript logic to listen to input events on the search box.
    3. Filter the rendered table/list of contributors based on whether their username contains the search query (case-insensitive).
    4. Ensure the UI updates smoothly without full re-renders that reset scroll positions.

---

## 4. Improve Accessibility Labels and Keyboard Navigation

*   **Title**: `accessibility: audit and improve keyboard navigation and aria labels`
*   **Labels**: `frontend`, `accessibility`, `good first issue`
*   **Description**:

    We want to ensure our landing page and dashboard are fully accessible to screen readers and navigable via keyboard.

    ### Tasks
    1. Audit [index.html](file:///index.html) and [app/index.html](file:///app/index.html) for semantic HTML elements.
    2. Add appropriate `aria-label`, `aria-expanded`, or other aria attributes to interactive buttons, links, and dropdowns.
    3. Ensure focus states are clearly visible and keyboard navigation (Tab key) moves logically through controls.
    4. Test keyboard interaction on the interactive graphs/tables.

---

## 5. Add Tests for Dataset Validation

*   **Title**: `test: add unit tests for data verification logic`
*   **Labels**: `testing`, `help wanted`
*   **Description**:

    Currently, data validation is performed by the script [validate_data.py](file:///scripts/validate_data.py). We want to introduce proper Python unit tests (using the built-in `unittest` module) to verify our data processing and parsing logic.

    ### Tasks
    1. Create a `tests/` directory in the repository root.
    2. Write unit tests that cover:
       - Parser outputs from `ethereum_pr_counter.py`.
       - Validation behavior in `validate_data.py` (e.g. testing duplicate PR detection, missing fields detection with mock CSVs).
       - Incremental lookback window computation.
    3. Ensure tests can be run easily via `python -m unittest discover tests`.
