# Here are your Instructions
python3 -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload

npx expo start

apk build steps 
1. cd android && ./gradlew clean
2. npx expo prebuild --clean --platform android
3. cd android && ./gradlew assembleRelease
4. 