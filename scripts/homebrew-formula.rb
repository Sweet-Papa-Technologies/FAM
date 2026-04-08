class Fam < Formula
  desc "FoFo Agent Manager — One config. Every agent."
  homepage "https://github.com/Sweet-Papa-Technologies/FAM"
  url "https://registry.npmjs.org/@sweetpapatech/fam/-/fam-1.0.0.tgz"
  # sha256 will be filled after npm publish
  license "MIT"
  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "1.0.0", shell_output("#{bin}/fam --version")
  end
end
