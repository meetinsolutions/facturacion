import os
import re
import base64
import subprocess

def verify_xml_signature(xml_path):
    print(f"\n[OPENSSL VERIFICATION] Analizando: {os.path.basename(xml_path)}")
    with open(xml_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Extraer certificado X.509
    cert_match = re.search(r'<ds:X509Certificate>([\s\S]*?)</ds:X509Certificate>', content)
    if not cert_match:
        print("ERROR: No se encontró ds:X509Certificate")
        return False
    cert_b64 = cert_match.group(1).strip()
    cert_der = base64.b64decode(cert_b64)
    der_path = '/tmp/test_cert.der'
    pubkey_path = '/tmp/test_pubkey.pem'
    with open(der_path, 'wb') as f:
        f.write(cert_der)

    # 2. Extraer llave pública con OpenSSL CLI
    subprocess.run(['openssl', 'x509', '-inform', 'der', '-in', der_path, '-pubkey', '-noout'],
                   stdout=open(pubkey_path, 'w'), check=True)

    # 3. Extraer SignedInfo
    signed_info_match = re.search(r'(<ds:SignedInfo[\s\S]*?</ds:SignedInfo>)', content)
    if not signed_info_match:
        print("ERROR: No se encontró ds:SignedInfo")
        return False
    signed_info = signed_info_match.group(1)
    signed_info_path = '/tmp/test_signedinfo.xml'
    with open(signed_info_path, 'w', encoding='utf-8') as f:
        f.write(signed_info)

    # 4. Extraer SignatureValue
    sig_match = re.search(r'<ds:SignatureValue[^>]*>([\s\S]*?)</ds:SignatureValue>', content)
    if not sig_match:
        print("ERROR: No se encontró ds:SignatureValue")
        return False
    sig_b64 = sig_match.group(1).strip()
    sig_bin = base64.b64decode(sig_b64)
    sig_path = '/tmp/test_sig.bin'
    with open(sig_path, 'wb') as f:
        f.write(sig_bin)

    # 5. Ejecutar openssl dgst -sha256 -verify
    cmd = ['openssl', 'dgst', '-sha256', '-verify', pubkey_path, '-signature', sig_path, signed_info_path]
    res = subprocess.run(cmd, capture_output=True, text=True)
    out = res.stdout.strip()
    print(f"OpenSSL CLI Output: {out}")
    if res.returncode == 0 and "Verified OK" in out:
        print("-> VERIFICACIÓN CRIPTOGRÁFICA OPENSSL INDEPENDIENTE: EXITOSA (Verified OK)")
        return True
    else:
        print(f"-> ERROR EN VERIFICACIÓN: {res.stderr}")
        return False

if __name__ == '__main__':
    vouchers = [
        '/opt/facturacion-test/output/50623112600310289012300100001010000000001127620604_firmado.xml',
        '/opt/facturacion-test/output/50623112600310289012300100001040000000002115049501_firmado.xml',
        '/opt/facturacion-test/output/50623112600310289012300100001030000000003198367249_firmado.xml',
        '/opt/facturacion-test/output/50623112600310289012300100001020000000004187133611_firmado.xml'
    ]
    all_ok = True
    for v in vouchers:
        if not verify_xml_signature(v):
            all_ok = False

    if all_ok:
        print("\n=======================================================")
        print("  TODAS LAS FIRMAS FUERON VERIFICADAS CON OPENSSL CLI  ")
        print("=======================================================")
    else:
        exit(1)
