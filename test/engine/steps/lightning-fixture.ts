/**
 * Small HTML pages that mimic the parts of Lightning markup the browser steps rely on:
 * required-field asterisks in labels, hidden copies of earlier pages, modals,
 * picklists (button + listbox), lookups (input + listbox) and record page fields.
 */

export const NEW_ACCOUNT_MODAL = `
<html><body>
  <!-- A hidden, cached copy of an earlier page, as Lightning keeps them -->
  <div style="display:none"><button>Save</button><label for="h">Account Name</label><input id="h"></div>

  <button onclick="document.getElementById('modal').style.display='block'">New</button>
  <button>Save &amp; New</button>

  <div id="modal" role="dialog" aria-labelledby="mt" style="display:none">
    <h2 id="mt">New Account</h2>

    <label for="name"><abbr title="required">*</abbr>Account Name</label>
    <input id="name">

    <label id="ind-label">Industry</label>
    <button id="ind" role="combobox" aria-labelledby="ind-label" data-value=""
      onclick="document.getElementById('ind-list').style.display='block'">--None--</button>
    <div id="ind-list" role="listbox" style="display:none">
      <div role="option" onclick="pick('Banking')">Banking</div>
      <div role="option" onclick="pick('Technology')">Technology</div>
      <div role="option" onclick="pick('Technology Services')">Technology Services</div>
    </div>

    <label for="parent">Parent Account</label>
    <input id="parent" role="combobox" oninput="document.getElementById('parent-list').style.display='block'">
    <div id="parent-list" role="listbox" style="display:none">
      <div role="option" onclick="document.getElementById('advanced').style.display='block'">Show more results for "Acme Corp"</div>
      <div role="option" onclick="document.getElementById('parent').value='Acme Corp'; this.parentNode.style.display='none'">Acme Corp • San Francisco</div>
    </div>

    <div id="advanced" style="display:none">Advanced Search</div>

    <label for="type">Type</label>
    <select id="type"><option>--None--</option><option>Customer</option><option>Partner</option></select>

    <button onclick="save()">Save</button>
  </div>
  <div id="toast"></div>

  <script>
    function pick(v) {
      const b = document.getElementById('ind');
      b.textContent = v; b.setAttribute('data-value', v);
      document.getElementById('ind-list').style.display = 'none';
    }
    function save() {
      document.getElementById('modal').style.display = 'none';
      document.getElementById('toast').textContent = 'Account "' + document.getElementById('name').value + '" was created.';
    }
  </script>
</body></html>`;

/** A record page. Fields use real shadow DOM like Lightning: the value sits in a slotted, shadowed element. */
export const RECORD_PAGE = `
<html><body>
  <h1>Acme Corp</h1>
  <records-highlights-details-item><p title="Close Date">Close Date</p><p>12/31/2026</p></records-highlights-details-item>
  <div role="tablist"><a role="tab" aria-selected="true">Details</a><a role="tab">Related</a></div>
  <records-record-layout-item field-label="Industry">
    <lightning-formatted-text slot="outputField" data-text="Banking"></lightning-formatted-text>
  </records-record-layout-item>
  <records-record-layout-item field-label="Account Name">
    <force-lookup slot="outputField" data-text="Acme Holdings"></force-lookup>
  </records-record-layout-item>
  <div data-target-selection-name="sfdc:RecordField.Account.Rating__c">
    <span slot="outputField">Hot</span>
  </div>
  <script>
    for (const item of document.querySelectorAll('records-record-layout-item')) {
      const root = item.attachShadow({ mode: 'open' });
      const label = item.getAttribute('field-label');
      root.innerHTML = '<span>' + label + '</span><div><slot name="outputField"></slot></div><button>Edit ' + label + '</button>';
    }
    for (const el of document.querySelectorAll('[data-text]')) {
      const extra = el.tagName === 'FORCE-LOOKUP' ? '<br><span>Preview</span>' : '';
      el.attachShadow({ mode: 'open' }).innerHTML = '<span>' + el.dataset.text + '</span>' + extra;
    }
  </script>
</body></html>`;

/** A console app: "New Account" opens as a workspace tab (not a modal), next to another tab with its own Save. */
export const CONSOLE_NEW_ACCOUNT = `
<html><body>
  <div role="tablist"><span role="tab">Home</span><span role="tab" aria-selected="true">New Account</span></div>
  <div role="tabpanel">
    <h2>Other Record</h2>
    <button onclick="document.getElementById('result').textContent='wrong save'">Save</button>
  </div>
  <div role="tabpanel">
    <div role="tabpanel">
      <h2>New Account</h2>
      <label for="n">Account Name</label><input id="n">
      <button onclick="document.getElementById('result').textContent='saved ' + document.getElementById('n').value">Save</button>
    </div>
  </div>
  <div id="result"></div>
</body></html>`;
