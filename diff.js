var fs = require('fs');
var glob = require('glob-fs')({ gitignore: false });
var jsdiff = require('diff');
var sha256 = require('js-sha256');
var cluster = require('set-clustering');
var difflib = require('difflib');
var beautify = require('js-beautify').html;
var rainbow = require('rainbow-code');

const diffFromBasePath = 'diffs/20181128-pattern_exports';
const diffToBasePath = 'diffs/20181203-pattern_exports';

const diffFromBasePathRegExp = new RegExp(diffFromBasePath + '/', 'g');
const diffToBasePathRegExp = new RegExp(diffToBasePath + '/', 'g');

const globbingPattern = '**/*.markup-only.html';

const readFilePathsGlob = globbingPattern => {
  return new Promise((resolve, reject) => {
    glob.readdir(globbingPattern, (err, files) => { if (err) { reject(err); } else { resolve(files); } });
  });
};

const readHtml = async filePath => {
  return await new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, htmlString) => { if (err) { reject(err); } else { resolve({ filePath, htmlString}); } });
  });
};

const filePathFilter = entry => entry === entry;

const removeDiffBasePaths = filePath =>
  filePath
    .replace(diffFromBasePathRegExp, '')
    .replace(diffToBasePathRegExp, '');

const hunksSimilarity = (change1, change2) => {
  return (new difflib.SequenceMatcher(null, change1.hunk.lines.join(''), change2.hunk.lines.join(''))).ratio();
};

const getUniqueFilepaths = changes => {
  let filePaths = [];

  changes.forEach(change => {
    filePaths = filePaths.concat(change.filePaths);
  });
  filePaths.filter((value, index, self) => { return self.indexOf(value) === index; });

  return filePaths;
};

const sortGroupsByFilePaths = (a, b) => { return a.filePaths[0].localeCompare(b.filePaths[0]); };
const sortFilePathsArray = (a, b) => { return a.localeCompare(b); };

const getFilePathBreadcrumb = filePath => {
  filePath = filePath.substr(filePath.lastIndexOf('/') + 1);
  filePath = filePath.substring(0, filePath.indexOf('.markup-only.html'));
  filePath = filePath.replace(/-(\d+)/g, '/$1');
  filePath = filePath.replace(/(\d+-\w+)-/g, '$1/');
  filePath = filePath.replace(/-_/g, '/_');

  filePathSegments = filePath.split('/');

  let breadcrumbMarkup = `
    <ul class="breadcrumbs">
      ${filePathSegments.map(filePathSegment => `<li>${filePathSegment}</li>`).join('\n')}
    </ul>
  `;

  return breadcrumbMarkup;
};

const getRootChangePathBreadcrumb = group => {
  let filePath = (group.sort(sortGroupsByFilePaths))[0].filePaths[0];

  return getFilePathBreadcrumb(filePath);
};

(async () => {
  const fromFilePaths = await readFilePathsGlob(`${diffFromBasePath}/${globbingPattern}`);
  const fromFilePathsFiltered = fromFilePaths.filter(filePathFilter);

  const toFilePaths = await readFilePathsGlob(`${diffToBasePath}/${globbingPattern}`);
  const toFilePathsFiltered = toFilePaths.filter(filePathFilter);

  let allFilePaths = [];

  let addedFilePaths = [];
  let removedFilePaths = [];
  let unchangedFilePaths = [];

  fromFilePathsFiltered.forEach(fromFilePath => {
    if (allFilePaths.indexOf(fromFilePath) < 0)
      allFilePaths.push(fromFilePath);

    toFilePaths.indexOf(`${diffToBasePath}/${removeDiffBasePaths(fromFilePath)}`) > 0
      ? unchangedFilePaths.push(removeDiffBasePaths(fromFilePath))
      : removedFilePaths.push(fromFilePath);
  });

  toFilePathsFiltered.forEach(toFilePath => {
    if (allFilePaths.indexOf(toFilePath) < 0)
      allFilePaths.push(toFilePath);

    if (fromFilePaths.indexOf(`${diffFromBasePath}/${removeDiffBasePaths(toFilePath)}`) < 0)
      addedFilePaths.push(toFilePath);
  });

  var htmlContentPromises = allFilePaths.map(filePath => {
    return readHtml(filePath);
  });

  Promise.all(htmlContentPromises).then(htmlContents => {
    let allFileContents = new Map();

    htmlContents.forEach(htmlContent => {
      allFileContents.set(htmlContent.filePath, htmlContent.htmlString);
    });

    let allChanges = new Map();

    unchangedFilePaths.forEach(unchangedFilePath => {
      const fromFilePath = `${diffFromBasePath}/${unchangedFilePath}`;
      const toFilePath = `${diffToBasePath}/${unchangedFilePath}`;

      let patch = jsdiff.structuredPatch(
        fromFilePath, toFilePath,
        allFileContents.get(fromFilePath),
        allFileContents.get(toFilePath),
        '', '', { context: 5 }
      );

      patch.hunks.forEach(hunk => {
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

    let indexStream = fs.createWriteStream('diffractor/src/pages/index.html');
    indexStream.once('open', () => {
      let indexMarkup = `
        <div style="margin-top: 30px;" class="grid-container">
          <div class="grid-x grid-padding-x">
            <div class="large-12 cell">
              <img class="logo" src="/assets/img/rm-logo.png">
              <h1>Changes grouped by similarity</h1>
            </div>
          </div>

          <div class="grid-x grid-padding-x">
            <div class="large-12 medium-12 cell">
              <table class="dashboard-table">
                <colgroup>
                  <col width="220">
                  <col width="280">
                </colgroup>
                <thead>
                  <tr>
                    <th><a href="#">Change stats <i class="fa fa-caret-down"></i></a></th>
                    <th><a href="#">Root changes <i class="fa fa-caret-down"></i></a></th>
                  </tr>
                </thead>
                <tbody>
                  ${similarGroups.map((group, groupIndex) => `
                  <tr style="vertical-align: top;">
                    <td style="position: relative;">
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
                              <ul>
                              ${group
                                .sort(sortGroupsByFilePaths)
                                .map(change => `<li>${getFilePathBreadcrumb(change.filePaths[0])}</li>`)
                                .join('\n')}
                              </ul>
                            </div>
                          </li>
                        </ul>
                      </div>
                      <a href="/patches/patch-${groupIndex}.html" style="margin: 10px 10px 0 0;" class="primary button">Show changes</a>
                    </td>
                  </tr>`
                  ).join('\n')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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
          <div style="margin-top: 30px;" class="grid-container">
            <div class="grid-x grid-padding-x">
              <div class="large-12 cell">
                <img class="logo" src="/assets/img/rm-logo.png">
                <h1>Similar Change <small>(id: ${groupIndex})</small></h1>
                <a class="primary button" href="/">back to start</a>
              </div>
            </div>

            <div class="grid-x grid-padding-x single-change">
              <div class="large-12 medium-12 cell">
                <table class="dashboard-table">
                  <colgroup>
                    <col width="220">
                    <col width="280">
                  </colgroup>
                  <thead>
                    <tr>
                      <th><a href="#">Similar change stats <i class="fa fa-caret-down"></i></a></th>
                      <th><a href="#">Files affected <i class="fa fa-caret-down"></i></a></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${similarGroup.map((change, changeIndex) => `
                    <tr style="vertical-align: top;">
                      <td style="position: relative;">
                        <ul class="stats-list" style="text-align: left; margin-left: 10px;">
                          <li>
                            <span class="h1">${changeIndex}</span><span class="stats-list-label">Similar change id</span>
                          </li>
                          <li>
                            <span class="h3">${change.filePaths.length}</span><span class="stats-list-label">Affected files</span>
                          </li>
                          <li class="h3">
                            <span class="h3">${groupIndex}</span><span class="stats-list-label">Change id</span>
                          </li>
                        </ul>
                        ${getFilePathBreadcrumb(change.filePaths[0])}
                      </td>
                      <td>
                        <div class="callout alert-callout-border primary">
                          <strong>Files affected!</strong> - files affected in similar change:
                          <ul class="accordion" style="margin-top: 8px;" data-accordion data-multi-expand="true" data-allow-all-closed="true">
                            <li class="accordion-item" data-accordion-item>
                              <a href="#" class="accordion-title"><strong>${change.filePaths.length}</strong> files affected</a>
                              <div class="accordion-content" data-tab-content>
                                <h6>Affected files</h6>
                                <ul>
                                ${change.filePaths
                                  .sort(sortFilePathsArray)
                                  .map(filePath => `<li>${getFilePathBreadcrumb(filePath)}</li>`)
                                  .join('\n')}
                                </ul>
                              </div>
                            </li>
                          </ul>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td colspan="2">
                        <pre class="change__diff">
                          <code>${rainbow.colorSync(change.hunk.lines.join('\n'), 'html')}</code>
                        </pre>
                      </td>
                    </tr>`
                    ).join('\n')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
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
