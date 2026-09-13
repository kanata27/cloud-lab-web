"use strict";

    const API_BASE = window.KANATA_CONFIG.apiBase;


    const usernameInput =
      document.getElementById("username");

    const passwordInput =
      document.getElementById("password");

    const submitButton =
      document.getElementById("submit-login");

    const statusElement =
      document.getElementById("login-status");

    const toggleButton =
      document.getElementById("show-password");


    let isSubmitting = false;
    function updateSubmitState() {
      submitButton.disabled =
        isSubmitting || !usernameInput.value.trim()
        || !passwordInput.value;
    }


    function showError(message) {
      statusElement.textContent = message;
      statusElement.dataset.error = "true";
      statusElement.hidden = false;
    }


    function clearStatus() {
      statusElement.textContent = "";
      statusElement.hidden = true;
      statusElement.dataset.error = "false";
    }


    usernameInput.addEventListener(
      "input",
      updateSubmitState
    );


    passwordInput.addEventListener(
      "input",
      updateSubmitState
    );


    toggleButton.addEventListener(
      "click",
      () => {

        const visible =
          passwordInput.type === "password";

        passwordInput.type =
          visible
            ? "text"
            : "password";

        toggleButton.textContent =
          visible
            ? "Скрыть"
            : "Показать";

        toggleButton.setAttribute(
          "aria-pressed",
          String(visible)
        );

        passwordInput.focus();
      }
    );


    document
      .getElementById("login-form")
      .addEventListener(
        "submit",
        async event => {

          event.preventDefault();

          if (isSubmitting) return;

          if (
            !usernameInput.value.trim()
            || !passwordInput.value
          ) {
            updateSubmitState();
            return;
          }

          clearStatus();

          isSubmitting = true;
          submitButton.disabled = true;
          submitButton.textContent = "Входим…";


          try {

            const response = await fetch(
              `${API_BASE}/login`,
              {
                method: "POST",
                cache: "no-store",
                credentials: "omit",
                signal: AbortSignal.timeout?.(15000),

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body: JSON.stringify({
                  username:
                    usernameInput.value.trim(),

                  password:
                    passwordInput.value
                })
              }
            );


            if (response.status === 429) {
              throw new Error("Слишком много попыток. Подожди немного и попробуй снова.");
            }

            if (response.status === 401) {
              throw new Error(
                "Неверный логин или пароль."
              );
            }


            if (!response.ok) {
              throw new Error(
                "Ошибка сервера. Попробуй ещё раз."
              );
            }


            const data =
              await response.json();


            if (typeof data.token !== "string" || !data.token.trim()) {
              throw new Error(
                "Сервер не вернул токен сессии."
              );
            }


            sessionStorage.setItem(
              "kanata_admin_token",
              data.token
            );


            passwordInput.value = "";


            window.location.replace(
              "./index.html"
            );

          } catch (error) {

            showError(
              error.message
              || "Не удалось войти."
            );

          } finally {

            isSubmitting = false;

            submitButton.textContent =
              "Войти";

            updateSubmitState();
          }
        }
      );


    updateSubmitState();


    window.addEventListener(
      "pagehide",
      () => {
        passwordInput.value = "";
      }
    );
