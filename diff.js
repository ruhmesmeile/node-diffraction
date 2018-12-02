var fs = require('fs');
var glob = require('glob-fs')({ gitignore: false });
var jsdiff = require('diff');
var sha256 = require('js-sha256');
var cluster = require('set-clustering');
var difflib = require('difflib');
var beautify = require('js-beautify').html;
var rainbow = require('rainbow-code');

const diffFromBasePath = 'diffs/20181119-pattern_exports';
const diffToBasePath = 'diffs/20181128-pattern_exports';

const diffFromBasePathRegExp = new RegExp(diffFromBasePath + '/', 'g');
const diffToBasePathRegExp = new RegExp(diffToBasePath + '/', 'g');

const globbingPattern = '**/*.markup-only.html';

const readFilePathsGlob = (globbingPattern) => {
  return new Promise((resolve, reject) => {
    glob.readdir(globbingPattern, (err, files) => { if (err) { reject(err); } else { resolve(files); } });
  });
};

const readHtml = async (filePath) => {
  return await new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, htmlString) => { if (err) { reject(err); } else { resolve({ filePath, htmlString}); } });
  });
};

const filePathFilter = (entry) => entry === entry;
// const filePathFilter = (entry) => entry.includes("09-pages");

const removeDiffBasePaths = (filePath) =>
  filePath
    .replace(diffFromBasePathRegExp, '')
    .replace(diffToBasePathRegExp, '');

const hunksSimilarity = (change1, change2) => {
  return (new difflib.SequenceMatcher(null, change1.hunk.lines.join(''), change2.hunk.lines.join(''))).ratio();
};

const getUniqueFilepaths = (changes) => {
  let filePaths = [];

  changes.forEach(change => {
    filePaths = filePaths.concat(change.filePaths);
  });
  filePaths.filter((value, index, self) => { return self.indexOf(value) === index; });

  return filePaths;
};

const sortFilePathsArray = (a, b) => { return a.filePaths[0].localeCompare(b.filePaths[0]); };

const getRootChangePathBreadcrumb = (group) => {
  let filePath = (group.sort(sortFilePathsArray))[0].filePaths[0];

  filePath = filePath.substr(filePath.lastIndexOf('/') + 1);
  filePath = filePath.substring(0, filePath.indexOf('.markup-only.html'));
  filePath = filePath.replace(/-(\d+)/g, '/$1');
  filePath = filePath.replace(/(\d+-\w+)-/g, '$1/');
  filePath = filePath.replace(/-_/g, '/_');

  filePathSegments = filePath.split('/');

  let breadcrumbMarkup = `
    <ul class="breadcrumbs" style="position: absolute; bottom: -10px; margin-left: 10px;">
      ${filePathSegments.map(filePathSegment => `<li>${filePathSegment}</li>\n`).join('')}
    </ul>
  `;

  return breadcrumbMarkup;
}

(async () => {
  const fromFilePaths = await readFilePathsGlob(`${diffFromBasePath}/${globbingPattern}`);
  const fromFilePathsFiltered = fromFilePaths.filter(filePathFilter);

  const toFilePaths = await readFilePathsGlob(`${diffToBasePath}/${globbingPattern}`);
  const toFilePathsFiltered = toFilePaths.filter(filePathFilter);

  let allFilePaths = [];

  let addedFilePaths = [];
  let removedFilePaths = [];
  let unchangedFilePaths = [];

  fromFilePathsFiltered.forEach((fromFilePath) => {
    if (allFilePaths.indexOf(fromFilePath) < 0)
      allFilePaths.push(fromFilePath);

    toFilePaths.indexOf(`${diffToBasePath}/${removeDiffBasePaths(fromFilePath)}`) > 0
      ? unchangedFilePaths.push(removeDiffBasePaths(fromFilePath))
      : removedFilePaths.push(fromFilePath);
  });

  toFilePathsFiltered.forEach((toFilePath) => {
    if (allFilePaths.indexOf(toFilePath) < 0)
      allFilePaths.push(toFilePath);

    if (fromFilePaths.indexOf(`${diffFromBasePath}/${removeDiffBasePaths(toFilePath)}`) < 0)
      addedFilePaths.push(toFilePath);
  });

  var htmlContentPromises = allFilePaths.map((filePath) => {
    return readHtml(filePath);
  });

  Promise.all(htmlContentPromises).then((htmlContents) => {
    let allFileContents = new Map();

    htmlContents.forEach((htmlContent) => {
      allFileContents.set(htmlContent.filePath, htmlContent.htmlString);
    });

    let allChanges = new Map();

    unchangedFilePaths.forEach((unchangedFilePath) => {
      const fromFilePath = `${diffFromBasePath}/${unchangedFilePath}`;
      const toFilePath = `${diffToBasePath}/${unchangedFilePath}`;

      let patch = jsdiff.structuredPatch(
        fromFilePath, toFilePath,
        allFileContents.get(fromFilePath),
        allFileContents.get(toFilePath),
        '', '', { context: 5 }
      );

      patch.hunks.forEach((hunk) => {
        let changeIdentifier = sha256(hunk.lines.join());

        if (allChanges.has(changeIdentifier)) {
          let currentChange = allChanges.get(changeIdentifier);
          currentChange.filePaths.push(unchangedFilePath);

          allChanges.set(changeIdentifier, currentChange);
        } else {
          allChanges.set(changeIdentifier, { hunk, filePaths: [ unchangedFilePath ] });
        };
      });
    });

    let c = cluster(Array.from(allChanges.values()), hunksSimilarity);
    let similarGroups = c.similarGroups(0.6);

    let indexStream = fs.createWriteStream('diffractor/src/partials/inference/change-table-rows.html');
    indexStream.once('open', () => {
      let indexMarkup = `
        ${similarGroups.map((group, groupIndex) => `
        <tr style="vertical-align: top;">
          <td style="position: relative;">
            <p class="dashboard-table-text">
              <ul class="stats-list" style="text-align: left; margin-left: 10px;">
                <li>
                  <span class="h1">${groupIndex}</span><span class="stats-list-label">Change id</span>
                </li>
                <li>
                  <span class="h3">${group.length}</span><span class="stats-list-label">Similar changes</span>
                </li>
                <li class="h3">
                  <span class="h3">${(getUniqueFilepaths(group)).length}</span><span class="stats-list-label">Affected files</span>
                </li>
              </ul>
            </p>
            ${getRootChangePathBreadcrumb(group)}
          </td>
          <td>
            <div class="callout alert-callout-border primary">
              <strong>Root changes!</strong> - changed root component per similar change:
              <ul class="accordion" style="margin-top: 8px;" data-accordion data-multi-expand="true" data-allow-all-closed="true">
                <li class="accordion-item" data-accordion-item>
                  <a href="#" class="accordion-title"><strong>${group.length}</strong> root changes</a>
                  <div class="accordion-content" data-tab-content>
                    <h6>Changed root components</h6>
                    <ul style="font-size: 0.75rem;">
                      ${group
                        .sort(sortFilePathsArray)
                        .map(change => `<li><em>${change.filePaths[0]}</em></li>`)
                        .join('\n')}
                    </ul>
                  </div>
                </li>
              </ul>
            </div>
            <a href="/patches/patch-${groupIndex}.html" style="margin: 10px 10px 0 0;" class="primary large button">Show changes</a>
          </td>
        </tr>\n`).join('')}
      `;

      indexStream.write(beautify(indexMarkup, {
        indent_size: 2,
        indent_inner_html: true
      }));

      indexStream.end();
    });

    similarGroups.forEach((similarGroup, groupIndex) => {
      let changeStream = fs.createWriteStream(`diffractor/src/pages/patches/patch-${groupIndex}.html`);
      changeStream.once('open', () => {
        let changeMarkup = `
          <h1>Group of similar changes index: ${groupIndex}</h1>
          <a href="/">back to start</a>
          ${similarGroup.map((change, changeIndex) => `
          <section class="change">
            <h2>Change index ${changeIndex}</h2>
            <p>Affected files:</p>
            <ul class="change__files">
              ${change.filePaths.map(filePath => `<li>${filePath}</li>\n`).join('')}
            </ul>
            <p>Change Diff:</p>
            <pre class="change__diff">
              <code>
                ${rainbow.colorSync(change.hunk.lines.join('\n'), 'html')}
              </code>
            </pre>
          </section>
          `).join('')}
          <script src="js/rainbow.min.js"></script>
        `;

        changeStream.write(beautify(changeMarkup, {
          indent_size: 2,
          indent_inner_html: true
        }));

        changeStream.end();
      });
    });
  });
})();
