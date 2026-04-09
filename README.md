# UTMfy Sales Dashboard

Lightweight internal dashboard to monitor sales and ROAS in real-time.

## Features
- Total Revenue, Spend, ROAS, and Sales count.
- Campaign-level breakdown with Facebook Marketing API integration.
- Recent sales feed with masked emails.
- Secure login (bcrypt + JWT).
- No frontend framework, zero-dependency UI.

## Local Setup
1. `cd dashboard`
2. `npm install`
3. Create a `.env` file with:
   ```
   DATABASE_URL=your_postgres_url
   JWT_SECRET=your_random_secret
   PORT=3000
   ```
4. Run `node setup_db.js` to initialize the database tables and indices.
5. Create an initial password hash:
   ```bash
   node -e "require('bcryptjs').hash('YOUR_PASSWORD', 10).then(h => console.log(h))"
   ```
6. Insert the hash and FB tokens into the `dashboard_settings` table:
   ```sql
   INSERT INTO dashboard_settings (key, value) VALUES 
   ('password_hash', 'RESULT_FROM_STEP_5'),
   ('fb_marketing_token', 'YOUR_FB_TOKEN'),
   ('fb_ad_account_id', 'act_YOUR_ACCOUNT_ID');
   ```
7. `npm start`

## Deployment (Easypanel)
The `Dockerfile` is ready. Just point Easypanel to the `dashboard/` directory and set the environment variables `DATABASE_URL` and `JWT_SECRET`.
