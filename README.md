# Comic Generator

Comic generator menggunakan el.js layout dan Gemini Nano Banana untuk menghasilkan gambar komik dengan karakter yang konsisten.

## Fitur

- Upload referensi karakter/objek/lokasi dengan nama
- Generate comic dari prompt text dengan reference matching
- Single panel image output
- SQLite backend untuk menyimpan referensi

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Backend Server

```bash
npm start
```

Backend akan berjalan di `http://localhost:3001`

### 3. Open Frontend

Buka `index.html` di browser atau gunakan live server dari project el.js.

Navigasi ke halaman **Comic Generator** di sidebar/navbar.

## Cara Penggunaan

### Upload Reference

1. Masukkan nama referensi (contoh: "Dina")
2. Pilih tipe: Character / Object / Location
3. Upload gambar
4. Klik "Upload Reference"

### Generate Comic

1. Pilih referensi yang akan digunakan (checkbox)
2. Tulis prompt (contoh: "Dina pergi ke hutan mencari lilyflower")
3. Klik "Generate Comic"
4. Tunggu hasil generate
5. Download gambar jika diperlukan

## Struktur File

```
comic-generator/
├── server.js              # Backend Node.js + SQLite
├── comic-generator.js     # Frontend page component
├── package.json           # Backend dependencies
├── index.html             # Main entry (modified)
└── comic-references.db    # SQLite database (auto-created)
```

## API Endpoints

### References

- `GET /api/references` - List semua referensi
- `POST /api/references` - Upload referensi baru
  ```json
  {
    "name": "Dina",
    "type": "character",
    "image_base64": "data:image/png;base64,..."
  }
  ```
- `DELETE /api/references/:id` - Hapus referensi

### Generate

- `POST /api/generate` - Generate comic image
  ```json
  {
    "prompt": "Dina pergi ke hutan mencari lilyflower",
    "reference_ids": [1, 2, 3]
  }
  ```
  
  Response:
  ```json
  {
    "success": true,
    "data": {
      "image_base64": "data:image/png;base64,...",
      "prompt": "Dina pergi ke hutan mencari lilyflower",
      "references_used": [
        { "name": "Dina", "type": "character" }
      ]
    }
  }
  ```

## Gemini Nano Banana Integration

Untuk mengintegrasikan dengan Gemini Nano Banana API:

1. Edit fungsi `callGeminiAPI` di `server.js` (baris ~210)
2. Ganti placeholder dengan endpoint API yang sebenarnya
3. Sesuaikan format request dan response

Contoh implementasi:

```javascript
async function callGeminiAPI(prompt, references) {
  const response = await fetch('https://your-gemini-api.com/v1/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY'
    },
    body: JSON.stringify({
      prompt: prompt,
      references: references.map(ref => ({
        name: ref.name,
        type: ref.type,
        image: ref.image_base64
      }))
    })
  });

  const result = await response.json();
  return { image_base64: result.image };
}
```

## Catatan

- Database SQLite akan otomatis dibuat saat server pertama kali dijalankan
- Gambar referensi disimpan sebagai base64 di database
- Backend berjalan di port 3001, frontend tetap menggunakan port yang sama dengan project el.js
