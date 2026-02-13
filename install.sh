#!/bin/bash
# Flare Agent Skills — One-line installer
# curl -sL https://raw.githubusercontent.com/canddao1-dotcom/flare-agent-skills/main/install.sh | bash
set -e

REPO="canddao1-dotcom/flare-agent-skills"
BRANCH="main"
SKILLS_DIR="${OPENCLAW_WORKSPACE:-${HOME}/.openclaw/workspace}/skills"
TMP_DIR=$(mktemp -d)

echo "🔥 Installing Flare Agent Skills..."
echo "   Target: ${SKILLS_DIR}"

# Download repo tarball
curl -sL "https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz" -o "${TMP_DIR}/flare-skills.tar.gz"

# Extract
tar -xzf "${TMP_DIR}/flare-skills.tar.gz" -C "${TMP_DIR}"

# Copy skills into workspace
EXTRACTED="${TMP_DIR}/flare-agent-skills-${BRANCH}/skills"
if [ ! -d "${EXTRACTED}" ]; then
  echo "❌ Download failed. Is the repo accessible?"
  rm -rf "${TMP_DIR}"
  exit 1
fi

mkdir -p "${SKILLS_DIR}"

INSTALLED=0
for skill_dir in "${EXTRACTED}"/*/; do
  skill_name=$(basename "${skill_dir}")
  dest="${SKILLS_DIR}/${skill_name}"
  
  if [ -d "${dest}" ]; then
    echo "   ⏭️  ${skill_name} (already exists, skipping)"
  else
    cp -r "${skill_dir}" "${dest}"
    echo "   ✅ ${skill_name}"
    INSTALLED=$((INSTALLED + 1))
  fi
done

# Install dependencies for wallet skill (ethers.js)
if [ -f "${SKILLS_DIR}/wallet/package.json" ]; then
  echo ""
  echo "📦 Installing dependencies..."
  cd "${SKILLS_DIR}/wallet" && npm install --silent 2>/dev/null && cd - >/dev/null
  echo "   ✅ node_modules ready"
fi

# Cleanup
rm -rf "${TMP_DIR}"

echo ""
echo "🔥 Done! ${INSTALLED} skills installed."
echo ""
echo "📋 Available skills:"
echo "   /cdp       — Enosys Loans stability pool"
echo "   /fb        — FlareBank — dashboard, mint/burn, claim, bankrate"
echo "   /ftso      — FTSO oracle prices"
echo "   /spectra   — Yield trading (PT/YT)"
echo "   /swap      — DEX swaps (Enosys, SparkDex, Blazeswap)"
echo "   /upshift   — Upshift yield vaults"
echo "   /wallet    — Balances, send, wrap, approve"
echo "   /sparkdex  — SparkDex V4 swap & LP (Algebra Integral)"
echo "   /enosys    — Enosys V3 swap & LP (Uniswap V3)"
echo ""
echo "⚙️  Set environment variables:"
echo "   export AGENT_WALLET=\"0xYourWallet\""
echo "   export AGENT_KEYSTORE=\"./keystore.json\""
echo "   export KEYSTORE_PASSWORD_PATH=\"./keystore-password\""
echo ""
echo "Docs: https://github.com/${REPO}"
echo "Built by @cand_dao 🤖"
