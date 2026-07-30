/**
 * The credit footer.
 *
 * The version comes from the manifest, never a hard-coded string: somebody
 * reporting a problem needs to be able to name the build they are on, and a
 * literal here would drift from the tag the first time anyone forgot.
 */

const REPO = 'https://github.com/AmigoUK/LtdLens';

export function AppFooter() {
  const version = chrome.runtime.getManifest().version;

  return (
    <footer class="app-footer">
      <a href="mailto:dev@attv.uk">dev@attv.uk</a>
      <span class="sep">·</span>
      <span>Project &amp; Development: Tomasz &lsquo;Amigo&rsquo; Lewandowski</span>
      <span class="sep">·</span>
      <a href="https://www.attv.uk" target="_blank" rel="noreferrer">
        www.attv.uk
      </a>
      <span class="sep">·</span>
      <a href={REPO} target="_blank" rel="noreferrer">
        GitHub
      </a>
      <span class="sep">·</span>
      <span class="mono">v{version}</span>
    </footer>
  );
}
