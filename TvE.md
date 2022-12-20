Node-RED FlexDash release process
=================================

Debug/test release
------------------
- Increment the FlexDash version number in order not to clobber the previous release,
  then push FlexDash main to github, a build with the new version number will be triggered.
  Technically, this builds a FD release version, which is OK if FD is just used for Node-RED.
```
npm version patch && git push && git push --tags && npm run build
```
- after the build succeeds, in **node-red-flexdash** run ./release.sh -f [FD version]
- after the release completes, in **node-red-corewidgets** bump the version number _carefully_
  then npm publish to the @dev channel:
```
npm version patch && npm publish --tag dev
```
- to install, use npm i @flexdash/node-red-xyz@dev

Production release
------------------
- FlexDash is already a production build...
- in node-red-flexdash run `./release.sh -r -f [FD version]`
- in node-red-corewidgets `git push --tags` ?????
