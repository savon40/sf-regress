/** Raw data captured while recording, before post-processing into a YAML test. */

/** A Playwright locator as described by the recorder's JSONL output. */
export type RecordedLocator = {
  kind: string; // role | label | text | placeholder | alt | title | test-id | default | nth | ...
  body: string | number;
  options?: { name?: string; exact?: boolean; attrs?: unknown[] };
  next?: RecordedLocator;
};

/** One line of Playwright's JSONL recorder output. */
export type RecordedAction = {
  name: string; // navigate | click | fill | press | select | check | uncheck | assertText | assertValue | assertVisible | assertChecked | assertSnapshot | openPage | closePage
  url?: string;
  selector?: string;
  locator?: RecordedLocator;
  text?: string;
  value?: string;
  key?: string;
  options?: string[];
  substring?: boolean;
  checked?: boolean;
};

/** A click seen by sf-regress's own listener, with the Salesforce context the recorder lacks. */
export type ClickEvent = {
  t: number;
  url: string;
  role: string;
  name: string;
  /** data-value, e.g. the API value of a picklist option. */
  value: string | null;
  /** ids on the clicked element and its ancestors (to match recorder selectors like [id="1197:0"]). */
  ids: string[];
  /** Field label when the click was inside a record page/form field. */
  field: string | null;
  /** Title of the modal the click was in. */
  dialog: string | null;
};

export type Navigation = { t: number; url: string };

export type Recording = {
  baseUrl: string;
  startedAt: string;
  actions: RecordedAction[];
  events: ClickEvent[];
  navigations: Navigation[];
};

/** A record the user created while recording (found by querying the org afterwards). */
export type CreatedRecord = {
  sobject: string;
  id: string;
  name?: string;
  createdAt: string;
};
