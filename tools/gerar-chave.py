"""Gera a chave que assina o APK e guarda nos Secrets do GitHub.

Rode uma vez só. Com a mesma chave, cada APK novo instala por cima do anterior sem perder os dados.
Uso: python tools/gerar-chave.py dono/repositorio
Precisa de: pip install cryptography, e o gh logado.
"""
import base64
import datetime
import pathlib
import secrets
import shutil
import subprocess
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import PrivateFormat, pkcs12
from cryptography.x509.oid import NameOID

repo = sys.argv[1] if len(sys.argv) > 1 else "papabolso/menos-tela"
out = pathlib.Path.home() / "menos-tela-chave"
out.mkdir(exist_ok=True)
if (out / "menostela.p12").exists():
    sys.exit(f"Já existe uma chave em {out}. Apague a pasta se quiser mesmo gerar outra.")

password = secrets.token_urlsafe(24)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Menos Tela")])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (
    x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
    .serial_number(x509.random_serial_number()).not_valid_before(now)
    .not_valid_after(now + datetime.timedelta(days=365 * 30)).sign(key, hashes.SHA256())
)
enc = (
    PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
    .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1())
    .build(password.encode())
)
data = pkcs12.serialize_key_and_certificates(b"menostela", key, cert, None, enc)
(out / "menostela.p12").write_bytes(data)
(out / "senha.txt").write_text(password)

# O gh instalado pelo winget pode não estar no PATH de terminais abertos antes da instalação.
gh = shutil.which("gh") or str(next(
    (pathlib.Path.home() / "AppData/Local/Microsoft/WinGet/Packages").glob("GitHub.cli*/bin/gh.exe"), "gh"))
for secret, value in [("KEYSTORE_BASE64", base64.b64encode(data).decode()), ("KEYSTORE_PASSWORD", password)]:
    subprocess.run([gh, "secret", "set", secret, "-R", repo], input=value, text=True, check=True)

print(f"Pronto! Chave salva em {out} (guarde uma cópia) e enviada aos Secrets de {repo}.")
