#! /bin/bash -e

# read commandline options
RELEASE=0
FDV=
while getopts ":hrf:" opt; do
  case $opt in
    h)
      echo "Usage: $0 [-h] [-r]"
      echo " -h show this help message and exit"
      echo " -r release the version"
      echo " -f <version> flexdash version to bundle"
      exit 0
      ;;
    r)
      RELEASE=1
      ;;
    f)
      FDV="$OPTARG"
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      exit 1
      ;;
  esac
done

v=$(npm version --no-git-tag-version patch)
(cd plugin; npm version --no-git-tag-version $v)
sed -i -e "/flexdash-plugin/s/=[0-9.]*/=${v#v}/" package.json
vmm=${v%.*}
vmm=${vmm#v}
echo "Bundling FlexDash ${FDV:-$vmm}"
./bundle.sh ${FDV:-$vmm}
git commit -a -m "version $v"
git push
( cd plugin; npm publish --tag dev )
npm publish --tag dev
echo RELEASE=$RELEASE
if [[ $RELEASE == 1 ]]; then
  echo "Release-tagging $v with 'latest'"
  npm dist-tag add @flexdash/node-red-flexdash-plugin@$v latest
  npm dist-tag add @flexdash/node-red-flexdash@$v latest
fi
echo ""
echo "***** Published $v with FlexDash $(cat flexdash/VERSION) *****"
